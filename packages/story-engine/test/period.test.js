// A period (a quarter, or any dates) of a collection: its own movie and a
// report of who did what. Made-up people and messages only.

import { describe, it, expect } from 'vitest';
import { combineHistories, buildEpisode, validateEpisode, cutHistory, quarterOf, quartersOf, periodLabel, checkPeriod, periodReport } from '../src/index.js';
import { mergeHistory } from './fixtures-merge.js';

const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86400000).toISOString().slice(0, 10);
function history(name, people, n, { offset = 0, tagAt = {} } = {}) {
  const commits = [];
  for (let i = 0; i < n; i++) {
    const [pname, email] = people[i % people.length];
    commits.push({
      sha: `${name}-${String(i).padStart(4, '0')}`.padEnd(40, '0'), date: `${day(i + offset)}T12:00:00+02:00`,
      message: i % 3 === 0 ? `feat: ${name} thing ${i}` : i % 7 === 1 ? `fix: ${name} bug ${i} (fixes #${i})` : `fix: ${name} bug ${i}`,
      author: { name: pname, email, login: null }, files: 2 + (i % 5), paths: [`src/${name}/f${i % 4}.js`], pr: null,
      issues: i % 7 === 1 ? [{ number: i, title: null }] : [], tags: tagAt[i] ? [tagAt[i]] : [], parents: 1,
    });
  }
  return { historyVersion: 1, repo: { owner: null, name, url: null, defaultBranch: 'main' }, source: 'git-log', truncated: false, commitLimit: null, totalCommits: n, fetchedAt: '2024-06-01T00:00:00Z', commits };
}
const ada = ['Ada Test', 'ada@work.test'];
const bob = ['Bob Test', 'bob@work.test'];
const cy = ['Cy Test', 'cy@work.test'];
// alpha: days 0..39 (Jan 1 – Feb 9), beta: days 20..59 (Jan 21 – Feb 29)
const alpha = history('alpha', [ada, bob], 40, { tagAt: { 5: 'v1.0.0', 25: 'v1.1.0' } });
const beta = history('beta', [ada, cy], 40, { offset: 20, tagAt: { 30: 'v2.0.0' } });
const combined = combineHistories([
  { history: alpha, name: 'Alpha', url: 'https://example.test/acme/alpha' },
  { history: beta, name: 'Beta', url: 'https://example.test/acme/beta' },
], { name: 'Team' });

describe('periods', () => {
  it('names calendar quarters and their dates', () => {
    expect(quarterOf('2024-02-10')).toEqual({ label: 'Q1 2024', from: '2024-01-01', to: '2024-03-31' });
    expect(quarterOf('2026-12-31')).toEqual({ label: 'Q4 2026', from: '2026-10-01', to: '2026-12-31' });
    expect(periodLabel('2024-04-01', '2024-06-30')).toBe('Q2 2024');
    expect(periodLabel('2024-01-15', '2024-02-10')).toBe('Jan 15 – Feb 10, 2024');
    expect(periodLabel('2023-12-01', '2024-01-31')).toBe('Dec 1, 2023 – Jan 31, 2024');
  });
  it('checks period dates', () => {
    expect(checkPeriod('2024-01-01', '2024-03-31')).toEqual({ from: '2024-01-01', to: '2024-03-31', id: '2024-01-01_2024-03-31', label: 'Q1 2024' });
    expect(() => checkPeriod('2024-03-31', '2024-01-01')).toThrow(/before/);
    expect(() => checkPeriod('2024-1-1', '2024-03-31')).toThrow(/YYYY-MM-DD/);
    expect(() => checkPeriod('2024-02-30', '2024-03-31')).toThrow(/YYYY-MM-DD/);
  });
  it('lists the quarters a timeline has commits in, with counts', () => {
    const ep = buildEpisode(combined);
    expect(quartersOf(ep.timeline)).toEqual([{ label: 'Q1 2024', from: '2024-01-01', to: '2024-03-31', commits: 80 }]);
    const long = buildEpisode(history('long', [ada, bob], 120, { offset: 60 })); // Mar 1 – Jun 28
    expect(quartersOf(long.timeline).map((q) => [q.label, q.commits])).toEqual([['Q2 2024', 89], ['Q1 2024', 31]]);
  });
});

describe('cutHistory', () => {
  it('keeps the commits dated inside the period, both ends included, by their own calendar date', () => {
    const cut = cutHistory(combined, { from: '2024-01-21', to: '2024-01-31' });
    expect(cut.commits.map((c) => c.date.slice(0, 10)).every((d) => d >= '2024-01-21' && d <= '2024-01-31')).toBe(true);
    expect(cut.commits).toHaveLength(22);
    expect(cut.totalCommits).toBe(22);
    expect(cut.period).toEqual({ from: '2024-01-21', to: '2024-01-31' });
    expect(cut.repos).toEqual(combined.repos);
  });
  it('builds a playable movie of just that period, its release hives starting with the period', () => {
    const ep = buildEpisode(cutHistory(combined, { from: '2024-01-21', to: '2024-02-29' }));
    expect(validateEpisode(ep)).toEqual([]);
    expect(ep.timeline.start).toBe('2024-01-21');
    const hives = ep.timeline.groups.filter((g) => g.kind === 'release');
    expect(hives.map((g) => g.tag)).toEqual(['Alpha v1.1.0', 'Beta v2.0.0']);
    expect(hives[0].start).toBe(0);
  });
});

describe('a period too short for a movie', () => {
  it('can still be read for a report', () => {
    const cut = cutHistory(combined, { from: '2024-01-01', to: '2024-01-03' });
    expect(() => buildEpisode(cut)).toThrow(/at least 10/);
    const ep = buildEpisode(cut, { minCommits: 1 });
    expect(ep.summary.commits).toBe(3);
  });
});

describe('periodReport', () => {
  const period = { from: '2024-01-21', to: '2024-02-29' };
  const ep = buildEpisode(cutHistory(combined, period), { identities: true });
  const rep = periodReport(ep, { ...period, collection: 'Team' });

  it('says what the period is and totals it', () => {
    expect(rep).toMatchObject({ reportVersion: 1, collection: 'Team', from: '2024-01-21', to: '2024-02-29', label: 'Jan 21 – Feb 29, 2024' });
    const commits = ep.timeline.commits;
    expect(rep.totals.commits).toBe(commits.length);
    expect(rep.totals.fixes).toBe(commits.filter((c) => c[2] === 'fix').length);
    expect(rep.totals.feats).toBe(commits.filter((c) => c[2] === 'feat').length);
    expect(rep.totals.developers).toBe(3);
    expect(rep.totals.stories).toBe(2);
    expect(rep.totals.releases).toBe(2);
  });
  it('lists every developer with their work per story, busiest first', () => {
    expect(rep.developers.map((d) => d.name)).toEqual(['Ada', 'Cy', 'Bob']);
    const a = rep.developers[0];
    expect(a.repos.map((r) => r.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(a.repos.reduce((n, r) => n + r.commits, 0)).toBe(a.commits);
    expect(a.first >= period.from && a.last <= period.to).toBe(true);
    for (const r of a.repos) expect(r.commits).toBe(r.fixes + r.feats + r.other);
  });
  it('lists the stories, busiest first', () => {
    expect(rep.stories.map((s) => s.name)).toEqual(['Beta', 'Alpha']);
    expect(rep.stories[1]).toMatchObject({ name: 'Alpha', url: 'https://example.test/acme/alpha', commits: 20, developers: 2, releases: ['v1.1.0'] });
  });
  it('lists features, fixes and releases with links into their own repo', () => {
    expect(rep.features.length).toBe(rep.totals.feats);
    const f = rep.features.find((x) => x.repo === 'Alpha');
    expect(f.url).toMatch(/^https:\/\/example\.test\/acme\/alpha\/commit\//);
    const linked = rep.fixes.find((x) => x.issues.length);
    expect(linked.url).toBe(`https://example.test/acme/${linked.repo.toLowerCase()}/issues/${linked.issues[0]}`);
    expect(rep.releases).toEqual([{ repo: 'Alpha', tag: 'v1.1.0', d: '2024-01-26' }, { repo: 'Beta', tag: 'v2.0.0', d: '2024-02-20' }]);
  });
  it('puts feature pull requests first, with the commits they brought in', () => {
    const one = buildEpisode(cutHistory(combineHistories([{ history: mergeHistory(), name: 'Demo', url: null }], { name: 'Solo' }), { from: '2024-01-01', to: '2024-01-31' }));
    const r = periodReport(one, { from: '2024-01-01', to: '2024-01-31', collection: 'Solo' });
    expect(r.features[0]).toMatchObject({ big: true, title: 'Add the command palette', who: 'Ada', commits: 6, repo: 'Demo' });
    expect(r.features.filter((x) => x.big)).toHaveLength(1);
    expect(r.features.some((x) => /palette part/.test(x.title))).toBe(false);
  });
});
