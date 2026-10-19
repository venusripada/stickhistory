// Token-free fetch through the REST API. GitHub allows 60 unauthenticated
// requests an hour, so this reads up to a couple of thousand commits with
// authors, dates and messages, but no file counts or linked issues.

import { ghFetch, GitHubError, abortError } from './http.js';

function lastPage(link) {
  const m = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link || '');
  return m ? Number(m[1]) : null;
}

/** @returns {Promise<import('@commit-wars/story-engine/src/types.js').History>} */
export async function fetchViaRest({ owner, repo, branch, maxCommits, since, token, signal, onProgress, fetchImpl, apiUrl }) {
  const req = (path) => ghFetch(`${apiUrl}${path}`, { token, signal, fetchImpl, maxWaitMs: 0 });
  onProgress?.({ phase: 'meta', message: `Looking up ${owner}/${repo}…` });
  const metaRes = await req(`/repos/${owner}/${repo}`);
  const meta = await metaRes.json();
  const useBranch = branch || meta.default_branch;

  const commits = [];
  let total = null;
  const perPage = 100;
  for (let page = 1; commits.length < maxCommits; page++) {
    if (signal?.aborted) throw abortError();
    const q = new URLSearchParams({ sha: useBranch, per_page: String(perPage), page: String(page) });
    if (since) q.set('since', since);
    let res;
    try { res = await req(`/repos/${owner}/${repo}/commits?${q}`); }
    catch (e) { if (e instanceof GitHubError && e.status === 409) throw new GitHubError(`${owner}/${repo} has no commits yet.`, { code: 'empty' }); throw e; }
    if (page === 1) { const lp = lastPage(res.headers.get('link')); total = lp ? lp * perPage : null; }
    const items = await res.json();
    for (const it of items) {
      if (commits.length >= maxCommits) break;
      commits.push({
        sha: it.sha,
        date: it.commit?.committer?.date || it.commit?.author?.date,
        message: String(it.commit?.message || '').split('\n')[0],
        author: { name: it.commit?.author?.name || null, email: it.commit?.author?.email || null, login: it.author?.login || null, avatarUrl: it.author?.avatar_url || null },
        files: null,
        paths: null,
        pr: null,
        parents: Array.isArray(it.parents) ? it.parents.length : 1,
        tags: [],
      });
    }
    onProgress?.({ phase: 'commits', fetched: commits.length, total: total ? Math.min(total, maxCommits) : null, message: `Fetched ${commits.length.toLocaleString('en-US')} commits${total ? ` of about ${Math.min(total, maxCommits).toLocaleString('en-US')}` : ''}`, rateRemaining: Number(res.headers.get('x-ratelimit-remaining')) });
    if (items.length < perPage) { if (total == null || page === 1) total = commits.length; break; }
  }

  onProgress?.({ phase: 'tags', message: 'Reading release tags…' });
  const tags = [];
  for (let page = 1; page <= 3; page++) {
    const res = await req(`/repos/${owner}/${repo}/tags?per_page=100&page=${page}`);
    const items = await res.json();
    for (const t of items) if (t.commit?.sha) tags.push({ name: t.name, sha: t.commit.sha });
    if (items.length < 100) break;
  }

  return {
    historyVersion: 1,
    repo: { owner, name: repo, url: meta.html_url || `https://github.com/${owner}/${repo}`, defaultBranch: useBranch },
    source: 'github-rest',
    truncated: total != null ? commits.length < total : commits.length >= maxCommits,
    commitLimit: maxCommits,
    totalCommits: total,
    fetchedAt: new Date().toISOString(),
    commits,
    tags,
  };
}
