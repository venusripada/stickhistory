import { describe, it, expect } from 'vitest';
import { buildEpisode, validateEpisode, SCHEMA_VERSION } from '../src/index.js';
import { secondsPerDay, isoOfDay, dayOfIso, commitRange, weekBuckets, totalsAt, activeAt, chapterAt, fixOf, commitUrl, C } from '../src/timeline.js';
import { syntheticHistory } from './fixtures.js';

const ep = buildEpisode(syntheticHistory());
const tl = ep.timeline;

describe('episode timeline', () => {
  it('is schema version 2 and validates', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(ep.schemaVersion).toBe(2);
    expect(validateEpisode(ep)).toEqual([]);
  });
  it('holds every commit, sorted by day, as compact tuples', () => {
    expect(tl.commits).toHaveLength(ep.summary.commits);
    expect(tl.start).toBe('2024-01-01');
    expect(tl.days).toBe(dayOfIso(tl, tl.end) + 1);
    for (let i = 1; i < tl.commits.length; i++) expect(tl.commits[i][C.day]).toBeGreaterThanOrEqual(tl.commits[i - 1][C.day]);
    const c = tl.commits.find((x) => x[C.kind] === 'fix');
    expect(c).toHaveLength(9);
    expect(typeof c[C.sha]).toBe('string');
    expect(['gremlin', 'beetle', 'crawler', 'wraith', 'moth', 'bomb']).toContain(c[C.type]);
    expect(tl.commits.find((x) => x[C.kind] === 'feat')[C.type]).toBeNull();
  });
  it('lists people by commit count with bots flagged', () => {
    const counts = tl.people.map((p) => p.commits);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(tl.commits.length);
    expect(tl.people.some((p) => p.bot)).toBe(true);
    for (const c of tl.commits) expect(tl.people[c[C.who]]).toBeTruthy();
  });
  it('carries release tags on their days with weights', () => {
    expect(tl.releases.map((r) => r.tag)).toEqual(['v0.5.0', 'v1.0.0', 'v1.1.3']);
    expect(tl.releases[1]).toMatchObject({ weight: 3 });
    expect(isoOfDay(tl, tl.releases[1].day)).toBe('2024-05-30');
  });
  it('keeps issue numbers and PRs on commits when known', () => {
    const e2 = buildEpisode(syntheticHistory({ withPr: true, withIssues: true }));
    const linked = e2.timeline.commits.filter((c) => c[C.issues]);
    expect(linked.length).toBeGreaterThan(0);
    expect(linked[0][C.pr]).toBeGreaterThan(999);
    expect(Number.isInteger(linked[0][C.issues][0])).toBe(true);
  });
  it('rejects version 1 episodes with a rebuild hint', () => {
    expect(validateEpisode({ schemaVersion: 1, summary: {}, chapters: [], roster: [] }).join(' ')).toMatch(/older version.*[Rr]ebuild/);
  });
});

describe('timeline selectors', () => {
  it('converts between days and dates', () => {
    expect(isoOfDay(tl, 0)).toBe('2024-01-01');
    expect(isoOfDay(tl, 31.7)).toBe('2024-02-01');
    expect(dayOfIso(tl, '2024-03-01')).toBe(60);
  });
  it('paces the movie to about ten minutes', () => {
    expect(secondsPerDay(tl) * tl.days).toBeCloseTo(600, 0);
    expect(secondsPerDay({ days: 5 })).toBe(3);
    expect(secondsPerDay({ days: 100000 })).toBe(0.05);
  });
  it('finds commits in a day range', () => {
    const [a, b] = commitRange(tl, 10, 20);
    expect(b - a).toBe(tl.commits.filter((c) => c[C.day] >= 10 && c[C.day] < 20).length);
    expect(tl.commits[a][C.day]).toBeGreaterThanOrEqual(10);
    expect(commitRange(tl, -5, 0)).toEqual([0, 0]);
    expect(commitRange(tl, 0, 1e9)).toEqual([0, tl.commits.length]);
  });
  it('buckets activity by week', () => {
    const w = weekBuckets(tl);
    expect(w).toHaveLength(Math.ceil(tl.days / 7));
    expect(w.reduce((n, x) => n + x.commits, 0)).toBe(tl.commits.length);
    expect(w.reduce((n, x) => n + x.fixes, 0)).toBe(tl.commits.filter((c) => c[C.kind] === 'fix').length);
    expect(w[1].day).toBe(7);
  });
  it('buckets one person\'s activity when following them', () => {
    const w = weekBuckets(tl, { who: 1 });
    expect(w).toHaveLength(Math.ceil(tl.days / 7));
    expect(w.reduce((n, x) => n + x.commits, 0)).toBe(tl.commits.filter((c) => c[C.who] === 1).length);
  });
  it('totals everything up to a day, optionally for one person', () => {
    const t = totalsAt(tl, 99.5);
    const upto = tl.commits.filter((c) => c[C.day] <= 99);
    expect(t.commits).toBe(upto.length);
    expect(t.fixes).toBe(upto.filter((c) => c[C.kind] === 'fix').length);
    expect(t.people).toBe(new Set(upto.map((c) => c[C.who])).size);
    expect(totalsAt(tl, 99, { who: 0 }).commits).toBe(upto.filter((c) => c[C.who] === 0).length);
    expect(totalsAt(tl, tl.days).commits).toBe(tl.commits.length);
  });
  it('ranks who is active in a window before the playhead', () => {
    const act = activeAt(tl, 100, { window: 14 });
    const win = tl.commits.filter((c) => c[C.day] > 86 && c[C.day] <= 100 && !tl.people[c[C.who]].bot);
    expect(act.reduce((n, a) => n + a.commits, 0)).toBe(win.length);
    expect(act[0].commits).toBeGreaterThanOrEqual(act[act.length - 1].commits);
    expect(act[0].total).toBe(tl.commits.filter((c) => c[C.day] <= 100 && c[C.who] === act[0].who).length);
    expect(act[0].name).toBe(tl.people[act[0].who].name);
    expect(act.every((a) => !tl.people[a.who].bot)).toBe(true);
  });
  it('finds the chapter for a day', () => {
    expect(chapterAt(ep, 0)).toBe(0);
    expect(chapterAt(ep, tl.days - 1)).toBe(ep.chapters.length - 1);
    const k = 2, d = dayOfIso(tl, ep.chapters[k].first);
    expect(chapterAt(ep, d)).toBe(k);
  });
});

describe('fix records from the timeline', () => {
  it('builds the same fix shape the player shows, with no nulls in text', () => {
    const e2 = buildEpisode(syntheticHistory({ withPr: true, withIssues: true }));
    const t2 = e2.timeline;
    const i = t2.commits.findIndex((c) => c[C.issues]);
    const fx = fixOf(t2, i);
    expect(fx).toMatchObject({ i, pr: t2.commits[i][C.pr], files: t2.commits[i][C.files], type: t2.commits[i][C.type], who: t2.people[t2.commits[i][C.who]].name });
    expect(fx.issues[0]).toEqual({ number: t2.commits[i][C.issues][0], title: null });
    expect(fx.d).toBe(isoOfDay(t2, t2.commits[i][C.day]));
    expect(fx.t).not.toMatch(/^fix|\(#\d+\)|null/);
    expect(fx.s).toBe(t2.commits[i][C.s]);
  });
  it('links to the issue, else the pull request, else the commit', () => {
    const u = 'https://github.com/acme/rocket';
    expect(commitUrl(u, { sha: 'abc', pr: 5, issues: [{ number: 9 }] })).toBe(`${u}/issues/9`);
    expect(commitUrl(u, { sha: 'abc', pr: 5, issues: [] })).toBe(`${u}/pull/5`);
    expect(commitUrl(u, { sha: 'abc', pr: null, issues: [] })).toBe(`${u}/commit/abc`);
    expect(commitUrl(null, { sha: 'abc' })).toBeNull();
  });
});
