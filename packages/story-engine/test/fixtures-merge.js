// A made-up history with pull requests merged by merge commits and two releases.

const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86400000).toISOString().slice(0, 10);
const who = { ada: { name: 'Ada Test', email: 'ada@x.test', login: null }, bob: { name: 'Bob Test', email: 'bob@x.test', login: null } };

/**
 * main: m0 .. m29, one commit a day. Two pull requests are merged into it:
 *   palette (6 feature commits by Ada, branched from m5, merged as m12, a feature PR)
 *   tidy    (6 commits by Bob that refactor and remove old code, branched from m14, merged as m20)
 *   tiny    (2 commits, merged as m24: too small for a boss)
 * Releases: v0.1.0 on m9, v0.2.0 on m22.
 */
export function mergeHistory() {
  const out = [];
  const main = [];
  const add = (c) => { out.push(c); return c.sha; };
  let prev = null;
  const branch = (name, from, n, author, subject, files, startDay) => {
    let p = from; const shas = [];
    for (let i = 0; i < n; i++) { p = add({ sha: `${name}${i}`, date: day(startDay + i * 0.1), author, message: subject(i), files, paths: ['src/x.js'], parentShas: [p], parents: 1, tags: [], issues: [] }); shas.push(p); }
    return p;
  };
  const tips = {};
  for (let i = 0; i < 30; i++) {
    const sha = `m${i}`;
    if (i === 6) tips.palette = branch('pal', 'm5', 6, who.ada, (k) => `feat: palette part ${k}`, 4, 6);
    if (i === 15) tips.tidy = branch('tidy', 'm14', 6, who.bob, (k) => (k === 2 ? 'refactor: remove the old settings store' : `refactor: move settings ${k}`), 30, 15);
    if (i === 23) tips.tiny = branch('tiny', 'm22', 2, who.bob, (k) => `fix: small thing ${k}`, 1, 23);
    const parents = i === 12 ? [prev, tips.palette] : i === 20 ? [prev, tips.tidy] : i === 24 ? [prev, tips.tiny] : prev ? [prev] : [];
    const msg = i === 12 ? 'Merge pull request #12 from ada/palette' : i === 20 ? 'Merge pull request #20 from bob/tidy-settings' : i === 24 ? 'Merge pull request #24 from bob/tiny' : (i % 2 ? `fix: main bug ${i}` : `feat: main thing ${i}`);
    const mergeTitle = i === 12 ? 'Add the command palette' : i === 20 ? 'Tidy the settings store' : i === 24 ? 'Two small fixes' : undefined;
    add({ sha, date: day(i), author: i % 3 ? who.ada : who.bob, message: msg, mergeTitle, files: i === 12 || i === 20 || i === 24 ? 0 : 2, paths: ['src/m.js'], parentShas: parents, parents: parents.length || 1, tags: i === 9 ? ['v0.1.0'] : i === 22 ? ['v0.2.0'] : [], issues: [] });
    main.push(sha); prev = sha;
  }
  // git log lists newest first
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { historyVersion: 1, repo: { owner: null, name: 'demo', url: null, defaultBranch: 'main' }, source: 'git-log', truncated: false, commitLimit: null, totalCommits: out.length, fetchedAt: '2024-02-01T00:00:00Z', commits: out };
}

