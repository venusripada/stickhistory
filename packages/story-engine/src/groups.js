// Bosses that spawn their work.
//
//   feature  a big feature pull request (merged with a merge commit, 5+ commits):
//            arrives on its merge date and spawns its commits
//   debt     the chapter's Tech Debt; if it came in through a pull request,
//            it arrives on the merge date and spawns that pull request's commits
//   release  a minor or major release: a hive standing from the previous
//            release to this one, out of which that period's work comes
//
// Squash-merged repositories have no pull request commits in git, so they get
// no feature bosses (their Tech Debt and releases still work).

import { kindOf, cleanTitle } from './classify.js';
import { dayOfIso } from './timeline.js';

const MIN_FEATURE_COMMITS = 5;
const FEATURES_PER_CHAPTER = 3;

/**
 * The commits each merge commit brought in, from parent links (git log mode).
 * For every merge on a repository's main line, walk its second parent back
 * along first parents until reaching the main line.
 * @param {{ sha: string, parentShas?: string[], date?: string, repo?: number }[]} commits
 * @returns {Map<string, string[]>}  merge sha -> member shas, newest first
 */
export function findPullRequests(commits) {
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const isParent = new Set(commits.flatMap((c) => c.parentShas || []));
  const out = new Map();
  const heads = new Map(); // repo -> newest commit that is nobody's parent
  for (const c of commits) {
    if (isParent.has(c.sha) || !(c.parentShas && c.parentShas.length)) continue;
    const r = c.repo ?? 0, h = heads.get(r);
    if (!h || String(c.date) > String(h.date)) heads.set(r, c);
  }
  for (const head of heads.values()) {
    const main = new Set();
    for (let c = head; c && !main.has(c.sha); c = bySha.get((c.parentShas || [])[0])) main.add(c.sha);
    for (const sha of main) {
      const m = bySha.get(sha);
      if (!m || !m.parentShas || m.parentShas.length < 2) continue;
      const members = [];
      for (let c = bySha.get(m.parentShas[1]); c && !main.has(c.sha) && members.length < 500; c = bySha.get((c.parentShas || [])[0])) {
        if (members.includes(c.sha)) break;
        members.push(c.sha);
      }
      if (members.length) out.set(sha, members);
    }
  }
  return out;
}

/**
 * @param {object} o
 * @param {any[]} o.raw       The history's commits (with parentShas, mergeTitle).
 * @param {any[]} o.commits   The engine's sorted, normalized commits (timeline order).
 * @param {{ start: number, end: number }[]} o.parts  Chapter boundaries.
 * @param {any[]} o.chapters  Built chapters (for their Tech Debt).
 * @param {{ start: string }} o.tl
 * @param {{ tag: string, day: number, weight: number }[]} o.releases
 * @returns {{ kind: 'feature'|'debt'|'release', title: string, who: string|null, at: number|null, day: number, start?: number, tag?: string, files: number|null, k?: number, members: number[] }[]}
 */
export function buildGroups({ raw, commits, parts, chapters, tl, releases }) {
  const idx = new Map(commits.map((c, i) => [c.sha, i]));
  const rawBySha = new Map(raw.map((c) => [c.sha, c]));
  const chapterOf = (i) => parts.findIndex((p) => i >= p.start && i < p.end);
  const busiest = (list) => { const n = new Map(); for (const c of list) n.set(c.who, (n.get(c.who) || 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  const prs = [...findPullRequests(raw)].map(([sha, members]) => ({ at: idx.get(sha), members: members.map((m) => idx.get(m)).filter((i) => i != null) }))
    .filter((p) => p.at != null && p.members.length);
  const groups = [];

  // big feature pull requests, at most a few per chapter
  const feats = [];
  for (const p of prs) {
    const m = commits[p.at], r = rawBySha.get(m.sha) || {};
    const title = r.mergeTitle || cleanTitle(m.message);
    const branch = (m.message.match(/from \S+?\/(\S+)/) || [])[1] || '';
    const mem = p.members.map((i) => commits[i]);
    const featureish = kindOf(title) === 'feat' || /\bfeat(ure)?s?\b/i.test(branch.replace(/[-_/]/g, ' ')) || mem.filter((c) => c.kind === 'feat').length * 2 > mem.length;
    if (p.members.length >= MIN_FEATURE_COMMITS && featureish) {
      feats.push({ kind: 'feature', title, who: busiest(mem) || m.who, at: p.at, day: dayOfIso(tl, m.d), files: mem.reduce((n, c) => n + (c.files || 0), 0) || null, k: chapterOf(p.at), members: [...p.members].sort((a, b) => a - b) });
    }
  }
  for (const k of new Set(feats.map((f) => f.k))) groups.push(...feats.filter((f) => f.k === k).sort((a, b) => b.members.length - a.members.length).slice(0, FEATURES_PER_CHAPTER));

  // Tech Debt: through its pull request when it came in through one
  chapters.forEach((ch, k) => {
    if (!ch.boss || !ch.boss.sha) return;
    const bi = idx.get(ch.boss.sha);
    if (bi == null) return;
    const pr = prs.find((p) => p.members.includes(bi));
    if (pr) groups.push({ kind: 'debt', title: ch.boss.s, who: ch.boss.who, at: pr.at, day: dayOfIso(tl, commits[pr.at].d), files: ch.boss.files, k, members: [...pr.members].sort((a, b) => a - b) });
    else groups.push({ kind: 'debt', title: ch.boss.s, who: ch.boss.who, at: bi, day: dayOfIso(tl, commits[bi].d), files: ch.boss.files, k, members: [] });
  });

  // releases: everything since the previous minor or major release, except work that comes with a boss
  const spoken = new Set(groups.flatMap((g) => g.members));
  let prev = -1;
  for (const r of releases.filter((x) => x.weight >= 2)) {
    const start = prev + 1;
    const members = [];
    commits.forEach((c, i) => {
      const d = dayOfIso(tl, c.d);
      if (d >= start && d <= r.day && !c.bot && (c.kind === 'fix' || c.kind === 'feat') && !spoken.has(i)) members.push(i);
    });
    groups.push({ kind: 'release', title: r.tag, tag: r.tag, who: null, at: null, day: r.day, start, files: null, members });
    prev = r.day;
  }
  return groups.sort((a, b) => a.day - b.day || (a.kind < b.kind ? -1 : 1));
}
