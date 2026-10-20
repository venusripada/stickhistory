// A period of a collection (a quarter, or any from/to dates): the history cut
// to those dates, so it plays as its own movie, and a report of who did what.

import { C, isoOfDay, commitUrl, fixOf, peopleSummary } from './timeline.js';
import { cleanTitle } from './classify.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** The calendar quarter a YYYY-MM-DD date is in. */
export function quarterOf(iso) {
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1, m0 = (q - 1) * 3 + 1, m1 = m0 + 2;
  return { label: `Q${q} ${y}`, from: `${y}-${pad(m0)}-01`, to: `${y}-${pad(m1)}-${lastDay(y, m1)}` };
}

/** "Q3 2026" for a whole quarter, otherwise the dates ("Jan 15 – Feb 10, 2024"). */
export function periodLabel(from, to) {
  const q = quarterOf(from);
  if (q.from === from && q.to === to) return q.label;
  const [y0, m0, d0] = from.split('-').map(Number), [y1, m1, d1] = to.split('-').map(Number);
  return y0 === y1 ? `${MON[m0 - 1]} ${d0} – ${MON[m1 - 1]} ${d1}, ${y1}` : `${MON[m0 - 1]} ${d0}, ${y0} – ${MON[m1 - 1]} ${d1}, ${y1}`;
}

/**
 * Check a period's dates. Throws a plain-language Error.
 * @returns {{ from: string, to: string, id: string, label: string }}
 */
export function checkPeriod(from, to) {
  for (const d of [from, to]) {
    const m = DATE.exec(String(d ?? ''));
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > lastDay(+m[1], +m[2])) throw new Error(`"${d ?? ''}" isn't a date. Use YYYY-MM-DD, like 2026-07-01.`);
  }
  if (from > to) throw new Error(`The period starts (${from}) after it ends (${to}). Pick a start date before the end date.`);
  return { from, to, id: `${from}_${to}`, label: periodLabel(from, to) };
}

/** Quarters with commits in a timeline, newest first: { label, from, to, commits }. */
export function quartersOf(tl) {
  const by = new Map();
  for (const c of tl.commits) {
    const q = quarterOf(isoOfDay(tl, c[C.day]));
    const have = by.get(q.label);
    if (have) have.commits++; else by.set(q.label, { ...q, commits: 1 });
  }
  return [...by.values()].sort((a, b) => (a.from < b.from ? 1 : -1));
}

/**
 * The commits dated from `from` to `to` (both included), by each commit's own calendar date.
 * @param {import('./types.js').History} history
 * @param {{ from: string, to: string }} period
 */
export function cutHistory(history, { from, to }) {
  const keep = history.commits.filter((c) => { const d = String(c.date).slice(0, 10); return d >= from && d <= to; });
  const shas = new Set(keep.map((c) => c.sha));
  const out = { ...history, commits: keep, totalCommits: keep.length, truncated: false, period: { from, to } };
  if (history.tags) out.tags = history.tags.filter((t) => shas.has(t.sha));
  return out;
}

/**
 * What happened in a period, from its episode: totals, every developer with
 * their work per story, the stories, features (feature pull requests first),
 * fixes and releases. Links go to each commit's own repository.
 * @param {any} ep  An episode built from cutHistory().
 * @param {{ from: string, to: string, collection: string }} o
 */
export function periodReport(ep, { from, to, collection }) {
  const tl = ep.timeline;
  const repos = tl.repos || [{ name: ep.summary.repo, url: ep.summary.repoUrl }];
  const repoOf = (c) => (tl.repos ? c[C.repo] ?? 0 : 0);
  const link = (i) => { const fx = fixOf(tl, i); return commitUrl(ep.summary.repoUrl, fx); };

  // per story and per developer per story
  const stories = repos.map((r) => ({ name: r.name, url: r.url ?? null, commits: 0, fixes: 0, feats: 0, devs: new Set(), releases: [] }));
  const perDev = new Map(); // who -> Map(repo -> counts)
  tl.commits.forEach((c) => {
    const r = repoOf(c), s = stories[r], k = c[C.kind];
    s.commits++; if (k === 'fix') s.fixes++; else if (k === 'feat') s.feats++;
    if (tl.people[c[C.who]].bot) return;
    s.devs.add(c[C.who]);
    if (!perDev.has(c[C.who])) perDev.set(c[C.who], new Map());
    const m = perDev.get(c[C.who]);
    if (!m.has(r)) m.set(r, { name: repos[r].name, commits: 0, fixes: 0, feats: 0, other: 0 });
    const x = m.get(r); x.commits++;
    if (k === 'fix') x.fixes++; else if (k === 'feat') x.feats++; else x.other++;
  });

  // releases: collection tags carry their story's name ("Alpha v1.1.0")
  const releases = tl.releases.map((rel) => {
    const r = tl.repos ? repos.findIndex((x) => rel.tag.startsWith(`${x.name} `)) : 0;
    const tag = r >= 0 && tl.repos ? rel.tag.slice(repos[r].name.length + 1) : rel.tag;
    if (r >= 0) stories[r].releases.push(tag);
    return { repo: r >= 0 ? repos[r].name : null, tag, d: isoOfDay(tl, rel.day) };
  });

  const developers = peopleSummary(tl).map((d) => ({
    name: d.name, commits: d.commits, fixes: d.fixes, feats: d.feats, first: d.first, last: d.last, names: d.names, emails: d.emails,
    repos: [...(perDev.get(d.who) || new Map()).values()].sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1)),
  }));

  // features: feature pull requests (with the commits they brought in), then the other feature commits
  const groups = tl.groups || [];
  const held = new Set(groups.filter((g) => g.kind === 'feature').flatMap((g) => g.members));
  const big = groups.filter((g) => g.kind === 'feature').map((g) => {
    const c = tl.commits[g.at];
    return { big: true, repo: repos[repoOf(c)].name, title: g.title, who: g.who, d: isoOfDay(tl, g.day), pr: c[C.pr], commits: g.members.length, sha: c[C.sha], url: link(g.at) };
  });
  const rest = [];
  tl.commits.forEach((c, i) => {
    if (c[C.kind] !== 'feat' || held.has(i)) return;
    rest.push({ big: false, repo: repos[repoOf(c)].name, title: cleanTitle(c[C.s]) || c[C.s], who: tl.people[c[C.who]].name, d: isoOfDay(tl, c[C.day]), pr: c[C.pr], commits: 1, sha: c[C.sha], url: link(i) });
  });
  const newest = (a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0);

  const fixes = [];
  tl.commits.forEach((c, i) => {
    if (c[C.kind] !== 'fix') return;
    fixes.push({ repo: repos[repoOf(c)].name, title: cleanTitle(c[C.s]) || c[C.s], who: tl.people[c[C.who]].name, d: isoOfDay(tl, c[C.day]), pr: c[C.pr], issues: c[C.issues] || [], sha: c[C.sha], url: link(i) });
  });
  fixes.sort(newest);

  const storyRows = stories.filter((s) => s.commits).map(({ devs, ...s }) => ({ ...s, developers: devs.size }))
    .sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1));
  return {
    reportVersion: 1,
    collection, from, to, label: periodLabel(from, to),
    totals: {
      commits: tl.commits.length, developers: developers.length, stories: storyRows.length,
      fixes: tl.commits.filter((c) => c[C.kind] === 'fix').length, feats: tl.commits.filter((c) => c[C.kind] === 'feat').length,
      featurePullRequests: big.length, releases: releases.length,
      issuesClosed: new Set(fixes.flatMap((f) => f.issues.map((n) => `${f.repo}#${n}`))).size,
    },
    stories: storyRows,
    developers,
    features: [...big.sort(newest), ...rest.sort(newest)],
    fixes,
    releases,
  };
}
