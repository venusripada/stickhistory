import { describe, it, expect } from 'vitest';
import { buildEpisode, TL } from '@commit-wars/story-engine';
import { syntheticHistory } from '../../story-engine/test/fixtures.js';
import { buildEvents, firstEventAt, eventsBetween, chooseLineup } from '../src/director.js';

const ep = buildEpisode(syntheticHistory({ withPr: true, withIssues: true }));
const tl = ep.timeline;
const human = (kind) => tl.commits.map((c, i) => [c, i]).filter(([c]) => c[TL.kind] === kind && !tl.people[c[TL.who]].bot).map(([, i]) => i);
const humanFix = human('fix');
const humanFeat = human('feat');

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
  it('turns every human feature into exactly one fight to finish it', () => {
    const builds = ev.filter((e) => e.type === 'feat' || e.type === 'featduel');
    expect(builds.map((e) => e.i).sort((a, b) => a - b)).toEqual(humanFeat);
    for (const e of builds) expect(Math.floor(e.t)).toBe(tl.commits[e.i][TL.day]);
  });
  it('makes each chapter\'s biggest features spotlight feature duels', () => {
    const big = ep.chapters.flatMap((ch) => ch.powerups.map((p) => p.sha));
    const duels = ev.filter((e) => e.type === 'featduel');
    expect(duels.length).toBe(new Set(big).size);
    for (const d of duels) expect(big.some((s) => s.startsWith(tl.commits[d.i][TL.sha]))).toBe(true);
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
    expect(ev.some((e) => e.type === 'featduel')).toBe(true);
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
    expect(mine.filter((e) => e.type === 'feat' || e.type === 'featduel').length).toBe(humanFeat.filter((i) => tl.commits[i][TL.who] === who).length);
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

describe('chooseLineup', () => {
  const hero = (name, o = {}) => ({ name, arrivedAt: 0, hasEnemy: false, ...o });
  const base = { max: 4, now: 10, minStay: 4, fill: [], forced: [] };
  it('brings on people who have something to fight, busiest first', () => {
    const r = chooseLineup({ ...base, busy: new Map([['Ada', 1], ['Bob', 5], ['Cy', 2]]), onStage: [] });
    expect(r.add).toEqual(['Bob', 'Cy', 'Ada']);
    expect(r.leave).toEqual([]);
  });
  it('fills an almost empty stage with recent committers', () => {
    const r = chooseLineup({ ...base, busy: new Map([['Ada', 1]]), fill: ['Ada', 'Dee', 'Eve'], onStage: [] });
    expect(r.add).toEqual(['Ada', 'Dee']);
  });
  it('sends home only people with nothing left to fight who have been on a while', () => {
    const onStage = [hero('Old'), hero('Fresh', { arrivedAt: 8 }), hero('Busy', { hasEnemy: true }), hero('Ada')];
    const r = chooseLineup({ ...base, busy: new Map([['Ada', 1], ['Bob', 1]]), onStage });
    expect(r.leave).toEqual(['Old']);
    expect(r.add).toEqual(['Bob']);
  });
  it('keeps the stage under the limit but always brings forced heroes', () => {
    const onStage = [hero('A', { hasEnemy: true }), hero('B', { hasEnemy: true }), hero('C', { hasEnemy: true }), hero('D', { hasEnemy: true })];
    const r = chooseLineup({ ...base, busy: new Map([['A', 1], ['B', 1], ['C', 1], ['D', 1], ['E', 9]]), onStage, forced: ['F'] });
    expect(r.add).toEqual(['F']);
  });
  it('prefers people already on stage, so the lineup does not churn', () => {
    const onStage = [hero('Low')];
    const r = chooseLineup({ ...base, max: 2, busy: new Map([['Low', 1], ['High', 5], ['Mid', 3]]), onStage });
    expect(r.leave).toEqual([]);
    expect(r.add).toEqual(['High']);
  });
});
