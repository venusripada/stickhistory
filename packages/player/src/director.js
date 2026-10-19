// What happens when. Turns an episode into one sorted list of stage events,
// each at a fractional day `t`, so the player only has to walk a cursor
// along it. Pure: the same episode always gives the same events.
//
//   fix      { i, who }            a fix commit: one enemy, fought by its author
//   duel     { i, who }            a chapter hero's biggest fix: a spotlight duel
//   feat     { i, who, big }       a feature: a power-up orb (big = a chapter highlight)
//   revert   { i, who }            a revert: the time-warp bolt
//   boss     { i, who, k }         chapter k's largest refactor: Tech Debt arrives
//   release  { tag, weight }       a minor or major release: flag and fireworks
//   chapter  { k }                 chapter k starts: title card

import { TL, dayOfIso } from '@commit-wars/story-engine';

/**
 * @param {object} ep  A schemaVersion 2 episode.
 * @param {{ who?: number|null }} [o]  Follow one person (index into timeline.people).
 */
export function buildEvents(ep, o = {}) {
  const tl = ep.timeline;
  const who = o.who ?? null;
  const bySha = new Map(tl.commits.map((c, i) => [c[TL.sha], i]));
  const find = (sha) => (sha ? bySha.get(String(sha).slice(0, 12)) : undefined);
  const duels = new Set(), bosses = new Map(), big = new Set();
  ep.chapters.forEach((ch, k) => {
    for (const h of ch.heroes) { const i = find(h.duel && h.duel.sha); if (i != null) duels.add(i); }
    const b = find(ch.boss && ch.boss.sha); if (b != null) bosses.set(b, k);
    for (const p of ch.powerups) { const i = find(p.sha); if (i != null) big.add(i); }
  });

  const ev = [];
  let dayStart = 0, n = 0;
  for (let i = 0; i < tl.commits.length; i++) {
    const c = tl.commits[i];
    if (i === 0 || c[TL.day] !== tl.commits[i - 1][TL.day]) {
      dayStart = i; n = 1;
      while (dayStart + n < tl.commits.length && tl.commits[dayStart + n][TL.day] === c[TL.day]) n++;
    }
    const p = c[TL.who];
    if (tl.people[p].bot || (who != null && p !== who)) continue;
    const t = c[TL.day] + (i - dayStart + 0.5) / n;
    if (bosses.has(i)) ev.push({ t, type: 'boss', i, who: p, k: bosses.get(i) });
    else if (c[TL.kind] === 'fix') ev.push({ t, type: duels.has(i) ? 'duel' : 'fix', i, who: p });
    else if (c[TL.kind] === 'feat') ev.push({ t, type: 'feat', i, who: p, big: big.has(i) });
    else if (c[TL.kind] === 'revert') ev.push({ t, type: 'revert', i, who: p });
  }
  for (const r of tl.releases) if (r.weight >= 2) ev.push({ t: r.day + 0.95, type: 'release', tag: r.tag, weight: r.weight });
  ep.chapters.forEach((ch, k) => ev.push({ t: Math.max(0, dayOfIso(tl, ch.first)), type: 'chapter', k }));
  const rank = { chapter: 0, release: 2 };
  return ev.map((e, n) => [e, n]).sort((a, b) => a[0].t - b[0].t || (rank[a[0].type] ?? 1) - (rank[b[0].type] ?? 1) || a[1] - b[1]).map(([e]) => e);
}

/** Index of the first event at or after `day`. */
export function firstEventAt(events, day) {
  let lo = 0, hi = events.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].t < day) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Events with from <= t < to. */
export function eventsBetween(events, from, to) {
  return events.slice(firstEventAt(events, from), firstEventAt(events, to));
}
