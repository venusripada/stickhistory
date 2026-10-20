// Read-side helpers for episode.timeline. The player and the page both use
// these, so every number on screen comes from one place. All pure.
//
// A timeline commit is a tuple; C names its slots:
//   [day, who, kind, files, type, sha, subject, pr, issues]          one repo
//   [day, who, kind, files, type, sha, subject, pr, issues, repo]    a collection (repo indexes timeline.repos)

import { cleanTitle, scopeOf } from './classify.js';

export const C = { day: 0, who: 1, kind: 2, files: 3, type: 4, sha: 5, s: 6, pr: 7, issues: 8, repo: 9 };

const DAY_MS = 86400000;
const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** Day index (0 = timeline.start) of a YYYY-MM-DD date. */
export const dayOfIso = (tl, iso) => Math.round((utc(String(iso).slice(0, 10)) - utc(tl.start)) / DAY_MS);

/** YYYY-MM-DD for a (possibly fractional) day index. */
export const isoOfDay = (tl, day) => new Date(utc(tl.start) + Math.floor(day) * DAY_MS).toISOString().slice(0, 10);

/** Screen seconds per calendar day at 1×: the whole history plays in about ten minutes. */
export const secondsPerDay = (tl) => Math.min(3, Math.max(0.05, 600 / Math.max(1, tl.days)));

function lowerBound(commits, day) {
  let lo = 0, hi = commits.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (commits[mid][C.day] < day) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Index range [from, to) of commits whose day is in [d0, d1). */
export function commitRange(tl, d0, d1) {
  const a = lowerBound(tl.commits, Math.ceil(d0));
  const b = lowerBound(tl.commits, Math.ceil(d1));
  return [a, Math.max(a, b)];
}

/**
 * Commits, fixes and features per 7-day bucket, starting at day 0.
 * @param {{ who?: number|null }} [o]  Only count one person.
 */
export function weekBuckets(tl, o = {}) {
  const out = [];
  for (let i = 0; i < Math.ceil(tl.days / 7); i++) out.push({ day: i * 7, commits: 0, fixes: 0, feats: 0 });
  for (const c of tl.commits) {
    if (o.who != null && c[C.who] !== o.who) continue;
    const w = out[Math.floor(c[C.day] / 7)];
    w.commits++;
    if (c[C.kind] === 'fix') w.fixes++;
    else if (c[C.kind] === 'feat') w.feats++;
  }
  return out;
}

/**
 * Running totals for everything up to and including `day`.
 * @param {{ who?: number|null }} [o]  Only count one person.
 */
export function totalsAt(tl, day, o = {}) {
  const [, to] = commitRange(tl, 0, Math.floor(day) + 1);
  const t = { commits: 0, fixes: 0, feats: 0, reverts: 0, refactors: 0, issues: 0, people: 0 };
  const seen = new Set();
  for (let i = 0; i < to; i++) {
    const c = tl.commits[i];
    if (o.who != null && c[C.who] !== o.who) continue;
    t.commits++;
    if (c[C.kind] === 'fix') { t.fixes++; if (c[C.issues]) t.issues += c[C.issues].length; }
    else if (c[C.kind] === 'feat') t.feats++;
    else if (c[C.kind] === 'revert') t.reverts++;
    else if (c[C.kind] === 'refactor') t.refactors++;
    seen.add(c[C.who]);
  }
  t.people = seen.size;
  return t;
}

/**
 * People (no bots) with commits in the `window` days up to and including
 * `day`, busiest first. `total` is their commit count up to `day`.
 * @param {{ window?: number, who?: number|null, limit?: number }} [o]
 */
export function activeAt(tl, day, o = {}) {
  const win = o.window ?? 14;
  const d = Math.floor(day);
  const [from, to] = commitRange(tl, d - win + 1, d + 1);
  const by = new Map();
  for (let i = from; i < to; i++) {
    const c = tl.commits[i], w = c[C.who];
    if (tl.people[w].bot || (o.who != null && w !== o.who)) continue;
    let a = by.get(w);
    if (!a) { a = { who: w, name: tl.people[w].name, commits: 0, fixes: 0, feats: 0, last: c[C.day], total: 0 }; by.set(w, a); }
    a.commits++; a.last = c[C.day];
    if (c[C.kind] === 'fix') a.fixes++; else if (c[C.kind] === 'feat') a.feats++;
  }
  if (by.size) for (let i = 0; i < to; i++) { const a = by.get(tl.commits[i][C.who]); if (a) a.total++; }
  const list = [...by.values()].sort((a, b) => b.commits - a.commits || b.last - a.last || a.who - b.who);
  return o.limit ? list.slice(0, o.limit) : list;
}

/** Index of the chapter that covers `day` (the latest one that started on or before it). */
export function chapterAt(ep, day) {
  const iso = isoOfDay(ep.timeline, Math.max(0, day));
  let k = 0;
  ep.chapters.forEach((ch, i) => { if (ch.first <= iso) k = i; });
  return k;
}

/**
 * A timeline commit as a display record: { i, sha, who, pr, issues, t, s, sc, d, files, type, kind, repo, repoUrl }.
 * `repo` and `repoUrl` are set in collection episodes (null for a single repo).
 * `t` is the short title, `s` the subject, `sc` the conventional-commit scope (or null);
 * issue titles are not kept in the timeline.
 */
export function fixOf(tl, i) {
  const c = tl.commits[i];
  const repo = tl.repos && c[C.repo] != null ? tl.repos[c[C.repo]] : null;
  return {
    repo: repo ? repo.name : null, repoUrl: repo ? repo.url : null,
    i, sha: c[C.sha], who: tl.people[c[C.who]].name, kind: c[C.kind],
    pr: c[C.pr], issues: (c[C.issues] || []).map((number) => ({ number, title: null })),
    t: cleanTitle(c[C.s]) || c[C.s], s: c[C.s], sc: scopeOf(c[C.s]) || null, d: isoOfDay(tl, c[C.day]), files: c[C.files], type: c[C.type],
  };
}

/** Link to the issue a fix closed, else its pull request, else the commit. Null without a repo URL. */
export function commitUrl(repoUrl, fx) {
  if (fx.repo != null) repoUrl = fx.repoUrl; // in a collection, each commit links into its own repo
  if (!repoUrl) return null;
  if (fx.issues && fx.issues.length) return `${repoUrl}/issues/${fx.issues[0].number}`;
  return fx.pr ? `${repoUrl}/pull/${fx.pr}` : `${repoUrl}/commit/${fx.sha}`;
}

/**
 * Everyone in a timeline who isn't a bot, busiest first: commits, fixes and
 * features, first and last commit dates, and (in a collection) commits per repo.
 * Names and emails are included when the episode recorded them.
 */
export function peopleSummary(tl) {
  const rows = tl.people.map((p) => ({ who: 0, name: p.name, bot: p.bot, commits: 0, fixes: 0, feats: 0, first: null, last: null, perRepo: new Map(), names: p.names || [], emails: p.emails || [] }));
  rows.forEach((r, i) => { r.who = i; });
  for (const c of tl.commits) {
    const r = rows[c[C.who]];
    r.commits++;
    if (c[C.kind] === 'fix') r.fixes++; else if (c[C.kind] === 'feat') r.feats++;
    const d = isoOfDay(tl, c[C.day]);
    if (!r.first || d < r.first) r.first = d;
    if (!r.last || d > r.last) r.last = d;
    if (tl.repos && c[C.repo] != null) r.perRepo.set(c[C.repo], (r.perRepo.get(c[C.repo]) || 0) + 1);
  }
  return rows.filter((r) => !r.bot && r.commits).map(({ perRepo, ...r }) => ({
    ...r,
    repos: [...perRepo.entries()].map(([k, n]) => ({ name: tl.repos[k].name, commits: n })).sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1)),
  })).sort((a, b) => b.commits - a.commits || (a.name < b.name ? -1 : 1));
}
