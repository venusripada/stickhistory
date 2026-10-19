// Synthetic histories for tests. Deterministic: no Math.random.

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const PEOPLE = [
  { name: 'Ada Lovelace', email: 'ada@example.com', login: 'ada' },
  { name: 'Grace Hopper', email: 'grace@example.com', login: 'grace' },
  { name: 'Linus T', email: 'linus@example.com', login: 'linus' },
  { name: 'Margaret H', email: 'mh@example.com', login: 'margaret' },
  { name: 'Ken T', email: 'ken@example.com', login: 'ken' },
];
const BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com', login: 'github-actions[bot]' };
const SUBJECTS = [
  'fix(tui): cursor jumps when resizing',
  'fix(app): sidebar layout overflows on small screens',
  'fix(core): crash when config is missing',
  'fix: memory leak in session cache',
  'fix(windows): paths with spaces break the shell tool',
  'feat(app): add command palette',
  'feat: support custom themes',
  'refactor(core): split session service',
  'docs: update readme',
  'chore: bump deps',
];

/**
 * @param {{ n?: number, withPr?: boolean, withIssues?: boolean, logins?: boolean, newestFirst?: boolean }} o
 */
export function syntheticHistory(o = {}) {
  seed = 7;
  const n = o.n ?? 600;
  const start = Date.UTC(2024, 0, 1);
  const commits = [];
  for (let i = 0; i < n; i++) {
    const p = i % 13 === 0 ? BOT : PEOPLE[Math.floor(Math.pow(rnd(), 1.6) * PEOPLE.length)];
    const subject = p === BOT ? 'chore: release' : pick(SUBJECTS);
    const pr = o.withPr ? {
      number: 1000 + i,
      title: subject,
      labels: subject.startsWith('fix') ? ['bug'] : [],
      issues: o.withIssues && subject.startsWith('fix') && i % 3 === 0 ? [{ number: 500 + i, title: `Bug report ${i}: ${subject.split(': ')[1]}`, labels: ['bug'] }] : [],
    } : null;
    commits.push({
      sha: (i.toString(16).padStart(8, '0') + 'abcdef0123456789abcdef0123456789').slice(0, 40),
      date: new Date(start + i * 86400000 * 0.5).toISOString(),
      message: pr ? `${subject} (#${pr.number})` : subject,
      author: { name: p.name, email: p.email, login: o.logins === false ? null : p.login },
      files: subject.startsWith('refactor') ? 40 + (i % 30) : 1 + (i % 12),
      paths: null,
      pr,
      tags: i === Math.floor(n * 0.5) ? ['v1.0.0'] : i === Math.floor(n * 0.24) ? ['v0.5.0'] : i === Math.floor(n * 0.77) ? ['v1.1.3'] : [],
      parents: 1,
    });
  }
  if (o.newestFirst) commits.reverse();
  return {
    historyVersion: 1,
    repo: { owner: 'acme', name: 'rocket', url: 'https://github.com/acme/rocket', defaultBranch: 'main' },
    source: o.logins === false ? 'git-log' : 'github-graphql',
    truncated: false, commitLimit: null, totalCommits: n, fetchedAt: '2026-01-01T00:00:00Z',
    commits,
  };
}
