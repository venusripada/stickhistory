// Several stories (repositories) of one collection as one history, so a
// collection can play as one movie. Each commit remembers its repo.

/**
 * @param {{ history: import('./types.js').History, name: string, url?: string|null }[]} parts
 * @param {{ name: string }} meta  The collection's name.
 * @returns {import('./types.js').History}  With `repos` and a `repo` index on every commit.
 */
export function combineHistories(parts, meta) {
  const repos = parts.map((p) => ({ name: p.name, url: p.url ?? null }));
  const commits = [];
  let fetchedAt = null;
  parts.forEach((p, repo) => {
    const own = String(p.history.repo?.name || '').toLowerCase();
    const extra = new Map();
    for (const t of p.history.tags || []) { if (!extra.has(t.sha)) extra.set(t.sha, []); extra.get(t.sha).push(t.name); }
    for (const c of p.history.commits) {
      const author = { ...c.author };
      // release automation that commits as the project itself is a bot in that repo
      if (own && String(author.name || '').toLowerCase() === own) author.bot = true;
      commits.push({ ...c, author, repo, tags: [...(c.tags || []), ...(extra.get(c.sha) || [])].map((t) => `${p.name} ${t}`) });
    }
    if (!fetchedAt || p.history.fetchedAt > fetchedAt) fetchedAt = p.history.fetchedAt;
  });
  return {
    historyVersion: 1,
    repo: { owner: null, name: meta.name, url: null, defaultBranch: null },
    source: 'collection',
    truncated: false,
    commitLimit: null,
    totalCommits: commits.length,
    fetchedAt: fetchedAt || new Date().toISOString(),
    repos,
    commits,
  };
}
