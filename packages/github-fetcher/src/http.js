// Shared request handling: auth, retries, rate limits and readable errors.

export class GitHubError extends Error {
  /** @param {string} msg @param {{ status?: number, code?: string, resetAt?: string|null }} [info] */
  constructor(msg, info = {}) { super(msg); this.name = 'GitHubError'; Object.assign(this, info); }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
});
export const abortError = () => Object.assign(new Error('Cancelled.'), { name: 'AbortError' });

function resetMessage(resetEpochSec) {
  if (!resetEpochSec) return '';
  const mins = Math.max(1, Math.ceil((resetEpochSec * 1000 - Date.now()) / 60000));
  return ` It resets in about ${mins} minute${mins === 1 ? '' : 's'}.`;
}

/**
 * fetch() with GitHub's conventions. Retries server errors and secondary
 * rate limits a few times; waits for a primary rate-limit reset only when it
 * is less than `maxWaitMs` away.
 *
 * @returns {Promise<Response>}
 */
export async function ghFetch(url, { token, method = 'GET', body, signal, fetchImpl, maxRetries = 3, maxWaitMs = 65000, onWait } = {}) {
  const f = fetchImpl || globalThis.fetch;
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw abortError();
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await f(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (attempt++ < maxRetries) { await sleep(800 * attempt, signal); continue; }
      throw new GitHubError(`Couldn't reach GitHub (${e && e.message ? e.message : 'network error'}). Check your connection and try again.`, { code: 'network' });
    }
    if (res.ok) return res;
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset')) || null;
    const retryAfter = Number(res.headers.get('retry-after')) || null;
    if (res.status === 401) throw new GitHubError('GitHub rejected the token. Check that it is pasted correctly and has not expired.', { status: 401, code: 'bad-token' });
    // Browsers only see these headers when GitHub exposes them over CORS, so also read the message.
    let bodyText = '';
    if ((res.status === 403 || res.status === 429) && remaining !== '0' && !retryAfter) { try { bodyText = await res.clone().text(); } catch { /* ignore */ } }
    const limited = remaining === '0' || retryAfter || res.status === 429 || /rate limit/i.test(bodyText);
    if ((res.status === 403 || res.status === 429) && limited) {
      const waitMs = retryAfter ? retryAfter * 1000 : reset ? reset * 1000 - Date.now() + 1000 : 60000;
      if (waitMs <= maxWaitMs && attempt++ < maxRetries) { onWait?.(waitMs); await sleep(waitMs, signal); continue; }
      throw new GitHubError(
        token ? `GitHub's rate limit for this token is used up.${resetMessage(reset)}` : `GitHub's rate limit for requests without a token is used up.${resetMessage(reset)} Add a token to keep going.`,
        { status: res.status, code: 'rate-limit', resetAt: reset ? new Date(reset * 1000).toISOString() : null },
      );
    }
    if (res.status >= 500 && attempt++ < maxRetries) { await sleep(1000 * attempt, signal); continue; }
    let detail = '';
    try { const j = await res.json(); detail = j && j.message ? j.message : ''; } catch { /* not JSON */ }
    if (res.status === 404) throw new GitHubError('', { status: 404, code: 'not-found', detail });
    if (res.status === 403) throw new GitHubError(`GitHub refused the request${detail ? `: ${detail}` : ''}.`, { status: 403, code: 'forbidden' });
    throw new GitHubError(`GitHub returned an error (${res.status}${detail ? `: ${detail}` : ''}).`, { status: res.status, code: 'http' });
  }
}
