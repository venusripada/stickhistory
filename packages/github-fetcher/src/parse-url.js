// Accepts the many ways people write a GitHub repo and returns owner/repo.

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * @param {string} input  "owner/repo", "https://github.com/owner/repo", ".../tree/branch",
 *   "git@github.com:owner/repo.git", "github.com/owner/repo/pull/12" …
 * @returns {{ owner: string, repo: string, branch: string|null }}
 */
export function parseRepoUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new RepoUrlError('Paste a GitHub repository link, like github.com/owner/repo.');
  s = s.replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/');
  let branch = null;
  let path;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) path = s;
  else {
    if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
    let u;
    try { u = new URL(s); } catch { throw new RepoUrlError(`"${input}" doesn't look like a link. Try github.com/owner/repo.`); }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'github.com') throw new RepoUrlError(`Only github.com links work for now; "${u.hostname}" isn't supported.`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new RepoUrlError('That link is missing the repository name. Use github.com/owner/repo.');
    path = parts[0] + '/' + parts[1];
    if (parts[2] === 'tree' && parts[3]) branch = decodeURIComponent(parts.slice(3).join('/'));
  }
  let [owner, repo] = path.split('/');
  repo = repo.replace(/\.git$/i, '');
  if (!NAME.test(owner) || !NAME.test(repo)) throw new RepoUrlError(`"${owner}/${repo}" isn't a valid repository name.`);
  return { owner, repo, branch };
}

export class RepoUrlError extends Error {
  constructor(msg) { super(msg); this.name = 'RepoUrlError'; }
}
