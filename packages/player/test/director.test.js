import { describe, it, expect } from 'vitest';
import { buildEpisode, TL } from '@commit-wars/story-engine';
import { syntheticHistory } from '../../story-engine/test/fixtures.js';
import { buildEvents, firstEventAt, eventsBetween } from '../src/director.js';

const ep = buildEpisode(syntheticHistory({ withPr: true, withIssues: true }));
const tl = ep.timeline;
const humanFix = tl.commits.map((c, i) => [c, i]).filter(([c]) => c[TL.kind] === 'fix' && !tl.people[c[TL.who]].bot).map(([, i]) => i);

describe('director events', () => {
  const ev = buildEvents(ep);
  it('is sorted by time and deterministic', () => {
    for (let i = 1; i < ev.length; i++) expect(ev[i].t).toBeGreaterThanOrEqual(ev[i - 1].t);
    expect(buildEvents(ep)).toEqual(ev);
  });
  it('turns every human fix into exactly one fight, on its own day', () => {
    const fights = ev.filter((e) => e.type === 'fix' || e.type === 'duel');
    expect(fights.map((e) => e.i).sort((a, b) => a - b)).toEqual(humanFix);
    for (const e of fights) expect(Math.floor(e.t)).toBe(tl.commits[e.i][TL.day]);
  });
  it('makes each chapter hero duel a spotlight duel', () => {
    const duelShas = ep.chapters.flatMap((ch) => ch.heroes.map((h) => h.duel && h.duel.sha).filter(Boolean));
    const duels = ev.filter((e) => e.type === 'duel');
    expect(duels.length).toBe(new Set(duelShas).size);
    for (const d of duels) expect(duelShas.some((s) => s.startsWith(tl.commits[d.i][TL.sha]))).toBe(true);
  });
  it('brings the chapter bosses, big features, reverts, releases and chapter cards', () => {
    expect(ev.filter((e) => e.type === 'boss').length).toBe(ep.chapters.filter((c) => c.boss).length);
    expect(ev.filter((e) => e.type === 'chapter').map((e) => e.k)).toEqual(ep.chapters.map((_, k) => k));
    expect(ev.filter((e) => e.type === 'release').map((e) => e.tag)).toEqual(tl.releases.filter((r) => r.weight >= 2).map((r) => r.tag));
    expect(ev.some((e) => e.type === 'feat' && e.big)).toBe(true);
    expect(ev.filter((e) => e.type === 'revert').length).toBe(tl.commits.filter((c) => c[TL.kind] === 'revert' && !tl.people[c[TL.who]].bot).length);
  });
  it('follows one person: only their fights and features, plus chapters and releases', () => {
    const who = 0;
    const mine = buildEvents(ep, { who });
    for (const e of mine) {
      if (e.type === 'chapter' || e.type === 'release') continue;
      expect(e.who).toBe(who);
    }
    expect(mine.filter((e) => e.type === 'fix' || e.type === 'duel').length).toBe(humanFix.filter((i) => tl.commits[i][TL.who] === who).length);
  });
  it('finds where to resume after a seek and slices by time', () => {
    const k = firstEventAt(ev, 100);
    expect(ev[k].t).toBeGreaterThanOrEqual(100);
    expect(ev[k - 1].t).toBeLessThan(100);
    expect(firstEventAt(ev, -1)).toBe(0);
    expect(firstEventAt(ev, 1e9)).toBe(ev.length);
    const slice = eventsBetween(ev, 50, 60);
    expect(slice.every((e) => e.t >= 50 && e.t < 60)).toBe(true);
    expect(slice.length).toBe(ev.filter((e) => e.t >= 50 && e.t < 60).length);
  });
});
