// @commit-wars/github-fetcher
// fetchHistory() returns a History for the story engine. With a token it
// uses GraphQL (file counts, pull requests, closed issues); without one it
// falls back to the REST API's 60 requests an hour.

import { fetchViaGraphQL } from './graphql.js';
import { fetchViaRest } from './rest.js';
import { GitHubError } from './http.js';
import { parseRepoUrl } from './parse-url.js';

export { parseRepoUrl, RepoUrlError } from './parse-url.js';
export { GitHubError } from './http.js';

export const DEFAULT_LIMITS = { withToken: 5000, withoutToken: 2000 };

/**
 * @param {object} opts
 * @param {string} [opts.url]        Any GitHub repo link; or pass owner + repo.
 * @param {string} [opts.owner]
 * @param {string} [opts.repo]
 * @param {string|null} [opts.branch]  Defaults to the repo's default branch.
 * @param {string|null} [opts.token]   A GitHub token with read access (fine-grained "public repositories" is enough).
 * @param {number} [opts.maxCommits]   Newest N commits. Defaults to 5,000 with a token, 2,000 without.
 * @param {string} [opts.since]        ISO date; only commits after it.
 * @param {AbortSignal} [opts.signal]
 * @param {(p:{phase:string,message:string,fetched?:number,total?:number|null})=>void} [opts.onProgress]
 * @param {typeof fetch} [opts.fetch]  Inject a fetch (tests, proxies).
 * @param {string} [opts.apiUrl='https://api.github.com']
 * @returns {Promise<import('@commit-wars/story-engine/src/types.js').History>}
 */
export async function fetchHistory(opts) {
  let { owner, repo, branch = null } = opts;
  if (opts.url) ({ owner, repo, branch } = { ...parseRepoUrl(opts.url), ...(opts.branch ? { branch: opts.branch } : {}) });
  if (!owner || !repo) throw new TypeError('fetchHistory needs a url, or an owner and repo.');
  const token = opts.token ? String(opts.token).trim() : null;
  const args = {
    owner, repo, branch, token,
    maxCommits: Math.max(10, opts.maxCommits ?? (token ? DEFAULT_LIMITS.withToken : DEFAULT_LIMITS.withoutToken)),
    since: opts.since || null,
    signal: opts.signal,
    onProgress: opts.onProgress,
    fetchImpl: opts.fetch,
    apiUrl: (opts.apiUrl || 'https://api.github.com').replace(/\/$/, ''),
  };
  try {
    return token ? await fetchViaGraphQL(args) : await fetchViaRest(args);
  } catch (e) {
    if (e instanceof GitHubError && e.code === 'not-found') {
      e.message = token
        ? `${owner}/${repo} wasn't found, or this token can't see it. Check the link, or use a token with access to that repository.`
        : `${owner}/${repo} wasn't found. If it's private, add a GitHub token that can read it.`;
    }
    throw e;
  }
}
