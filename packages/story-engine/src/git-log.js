// Parses the output of `git log` into a History, so local repositories (or a
// pasted log file) work without the GitHub API.

/**
 * The command users run. %x1f is the ASCII unit separator, safe in any subject.
 * The body (%b) can span lines, so %x1e (record separator) marks where it ends.
 */
export const GIT_LOG_FORMAT = '@@@%H%x1f%ad%x1f%an%x1f%ae%x1f%P%x1f%D%x1f%s%x1f%b%x1e';
export const GIT_LOG_COMMAND = `git log --no-renames --name-only --date=short --format='${GIT_LOG_FORMAT}'`;

const MAX_BODY = 2000;
const tagsFromDecoration = (dec) => [...String(dec || '').matchAll(/tag: ([^,]+)/g)].map((m) => m[1].trim());

const CLOSING_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:#(\d+)\b|([\w.-]+)\/([\w.-]+)#(\d+)\b|https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\b)/gi;

/**
 * Issues a commit message closes, using GitHub's closing keywords ("Fixes #12",
 * "closes: #3"). References to another repo count only when they name `repo`.
 * Titles are unknown without the API, so they are null.
 *
 * @param {string} text  Subject and body.
 * @param {{ owner?: string|null, name?: string|null }} [repo]
 * @returns {{ number: number, title: null, labels: string[] }[]}
 */
export function closingIssues(text, repo = {}) {
  const same = (o, n) => !!(repo.owner && repo.name) && o.toLowerCase() === repo.owner.toLowerCase() && n.replace(/\.git$/, '').toLowerCase() === repo.name.toLowerCase();
  const seen = new Set();
  const out = [];
  for (const m of String(text || '').matchAll(CLOSING_RE)) {
    const num = m[1] ? Number(m[1]) : m[4] ? (same(m[2], m[3]) ? Number(m[4]) : null) : same(m[5], m[6]) ? Number(m[7]) : null;
    if (num && !seen.has(num)) { seen.add(num); out.push({ number: num, title: null, labels: [] }); }
  }
  return out;
}

/**
 * @param {string} text  Output of GIT_LOG_COMMAND. Logs made without the body
 *   field, and the older `--format='@@@%h|%ad|%an|%D|%s'`, are accepted too.
 * @param {{ repoName?: string, repoUrl?: string|null, owner?: string|null }} [meta]
 * @returns {import('./types.js').History}
 */
export function parseGitLog(text, meta = {}) {
  const commits = [];
  const repo = { owner: meta.owner ?? null, name: meta.repoName ?? null };
  let cur = null;
  let body = null; // lines of the current commit's body until the %x1e marker
  const endBody = () => {
    cur.issues = closingIssues(cur.message + '\n' + body.join('\n'), repo);
    // the body is kept (clipped) so a feature can be found in it
    const text = body.join('\n').trim();
    if (text) cur.body = text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text;
    // a merge commit's body starts with its pull request's title
    if (cur.parents > 1) { const t = body.map((l) => l.trim()).find(Boolean); if (t) cur.mergeTitle = t; }
    body = null;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    if (body) {
      const end = raw.indexOf('\x1e');
      body.push(end < 0 ? raw : raw.slice(0, end));
      if (end >= 0) endBody();
    } else if (raw.startsWith('@@@')) {
      const line = raw.slice(3);
      let c = null;
      let bodyStart = null;
      if (line.includes('\x1f')) {
        const [sha, date, name, email, parents, dec, subject, ...rest] = line.split('\x1f');
        const parentShas = parents ? parents.trim().split(/\s+/).filter(Boolean) : [];
        c = { sha: sha.trim(), date: date.trim(), author: { name: name || null, email: email || null, login: null }, parents: parentShas.length || 1, parentShas, tags: tagsFromDecoration(dec), message: String(subject || '').trim() };
        if (rest.length) bodyStart = rest.join('\x1f');
      } else {
        const p = line.split('|');
        if (p.length >= 5) c = { sha: p[0].trim(), date: p[1].trim(), author: { name: p[2].trim() || null, email: null, login: null }, parents: 1, tags: tagsFromDecoration(p[3]), message: p.slice(4).join('|').trim() };
      }
      if (c && /^\d{4}-\d{2}-\d{2}/.test(c.date)) {
        c.files = 0; c.paths = []; c.pr = null; c.issues = closingIssues(c.message, repo);
        commits.push(c); cur = c;
        if (bodyStart != null) {
          const end = bodyStart.indexOf('\x1e');
          body = [end < 0 ? bodyStart : bodyStart.slice(0, end)];
          if (end >= 0) endBody();
        }
      } else cur = null;
    } else if (cur && raw.trim()) {
      cur.files++;
      if (cur.paths.length < 300) cur.paths.push(raw.trim());
    }
  }
  if (body) endBody();
  return {
    historyVersion: 1,
    repo: { owner: meta.owner ?? null, name: meta.repoName || 'your repo', url: meta.repoUrl ?? null, defaultBranch: meta.branch ?? null },
    source: 'git-log',
    truncated: false,
    commitLimit: null,
    totalCommits: commits.length,
    fetchedAt: new Date().toISOString(),
    commits,
  };
}
