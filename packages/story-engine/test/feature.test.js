// A feature of a collection: every commit, across repositories, that names it.
// Made-up people, messages and paths only.

import { describe, it, expect } from 'vitest';
import { combineHistories, buildEpisode, validateEpisode, parseGitLog, checkFeature, featureMatcher, featureSignals, branchOf, cutFeature, featureReport } from '../src/index.js';

const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86400000).toISOString().slice(0, 10);
const ada = { name: 'Ada Test', email: 'ada@work.test', login: null };
const bob = { name: 'Bob Test', email: 'bob@work.test', login: null };
let n = 0;
const commit = (o) => ({ sha: `c${String(++n).padStart(4, '0')}`.padEnd(40, '0'), date: day(n), author: ada, files: 1, paths: ['src/other.js'], pr: null, issues: [], tags: [], parents: 1, parentShas: [], ...o });
const history = (name, commits) => ({ historyVersion: 1, repo: { owner: null, name, url: null, defaultBranch: 'main' }, source: 'git-log', truncated: false, commitLimit: null, totalCommits: commits.length, fetchedAt: '2024-06-01T00:00:00Z', commits });

describe('checkFeature', () => {
  it('accepts a name and gives it an id', () => {
    expect(checkFeature('  Live  Serve ')).toEqual({ name: 'Live Serve', id: 'live-serve', label: 'Live Serve' });
    expect(checkFeature('liveserve').id).toBe('liveserve');
  });
  it('refuses names that are too short, too long or have other characters', () => {
    expect(() => checkFeature('a')).toThrow(/2 to 40/);
    expect(() => checkFeature('x'.repeat(41))).toThrow(/2 to 40/);
    expect(() => checkFeature('live/serve')).toThrow(/2 to 40/);
    expect(() => checkFeature('-x')).toThrow(/2 to 40/);
  });
});

describe('featureMatcher', () => {
  const m = featureMatcher('liveserve');
  it('matches the name in any case, with separators ignored', () => {
    for (const s of ['liveserve', 'Add LiveServe cache', 'live-serve retries', 'live_serve.py', 'the Live Serve page', 'LIVESERVE', 'services/liveserve/x.js'])
      expect(m(s), s).toBe(true);
  });
  it('matches inside camelCase names', () => {
    expect(m('LiveServeClient.java')).toBe(true);
    expect(m('getLiveServe()')).toBe(true);
  });
  it('matches whole words only', () => {
    for (const s of ['liveserver', 'myliveserve', 'liveserve2', 'live, serve', 'deliver serve', ''])
      expect(m(s), s).toBe(false);
    expect(m(null)).toBe(false);
  });
  it('treats a name typed with spaces the same', () => {
    expect(featureMatcher('Live Serve')('liveserve')).toBe(true);
  });
});

describe('featureSignals', () => {
  const m = featureMatcher('liveserve');
  it('finds the name in the subject, body and pull request title', () => {
    expect(featureSignals({ message: 'Speed up liveserve' }, m)).toEqual(['text']);
    expect(featureSignals({ message: 'Speed up cache', body: 'Needed by LiveServe.' }, m)).toEqual(['text']);
    expect(featureSignals({ message: 'Merge pull request #4 from acme/fix-9', mergeTitle: 'Liveserve retries', parents: 2 }, m)).toEqual(['text']);
  });
  it('finds a conventional scope without counting it as text', () => {
    expect(featureSignals({ message: 'feat(liveserve): cache warmup' }, m)).toEqual(['scope']);
    expect(featureSignals({ message: 'fix(api,liveserve): retries' }, m)).toEqual(['scope']);
  });
  it('finds file paths', () => {
    expect(featureSignals({ message: 'tidy', paths: ['a.js', 'services/live-serve/b.js'] }, m)).toEqual(['path']);
  });
  it('finds the branch of a merge, without counting its subject as text', () => {
    expect(branchOf('Merge pull request #12 from acme/liveserve-retries')).toBe('liveserve-retries');
    expect(branchOf("Merge branch 'liveserve-x' into main")).toBe('liveserve-x');
    expect(branchOf("Merge remote-tracking branch 'origin/liveserve'")).toBe('liveserve');
    expect(branchOf('feat: liveserve')).toBe(null);
    expect(featureSignals({ message: 'Merge pull request #12 from acme/liveserve-retries' }, m)).toEqual(['branch']);
  });
  it('finds nothing in unrelated commits', () => {
    expect(featureSignals({ message: 'feat: liveserver', body: 'myliveserve', paths: ['liveserver/a.js'] }, m)).toEqual([]);
  });
});

describe('cutFeature and featureReport', () => {
  // alpha: a merged rocketpad branch with three commits, a scope, a path, a decoy
  const a1 = commit({ message: 'feat: start', parentShas: [] });
  const b1 = commit({ message: 'wip: retry loop', parentShas: [a1.sha] });
  const b2 = commit({ message: 'tests for the loop', parentShas: [b1.sha], author: bob });
  const b3 = commit({ message: 'fix: loop edge', parentShas: [b2.sha] });
  const m1 = commit({ message: 'Merge pull request #7 from acme/rocketpad-retries', mergeTitle: 'Retries', parents: 2, parentShas: [a1.sha, b3.sha], files: 0 });
  const s1 = commit({ message: 'feat(rocketpad): keys', parentShas: [m1.sha] });
  const p1 = commit({ message: 'chore: move files', paths: ['services/rocketpad/a.js'], parentShas: [s1.sha] });
  const d1 = commit({ message: 'feat: rocketpadder decoy', parentShas: [p1.sha] });
  const alpha = history('alpha', [a1, b1, b2, b3, m1, s1, p1, d1]);
  // beta: one mention in a body
  const t1 = commit({ message: 'fix: cache misses', body: 'Seen in RocketPad.', author: bob });
  const t2 = commit({ message: 'feat: unrelated' });
  const beta = history('beta', [t1, t2]);
  const combined = combineHistories([
    { history: alpha, name: 'Alpha', url: 'https://example.test/acme/alpha' },
    { history: beta, name: 'Beta', url: 'https://example.test/acme/beta' },
  ], { name: 'Team' });

  const { history: cut, signals } = cutFeature(combined, 'rocketpad');
  it('keeps the matching commits of every repository, with how each matched', () => {
    expect(cut.commits.map((c) => c.message)).toEqual([
      'wip: retry loop', 'tests for the loop', 'fix: loop edge', 'Merge pull request #7 from acme/rocketpad-retries',
      'feat(rocketpad): keys', 'chore: move files', 'fix: cache misses',
    ]);
    expect(cut.totalCommits).toBe(7);
    expect(cut.feature).toBe('rocketpad');
    expect(signals[`0:${b1.sha}`]).toEqual(['via-merge']);
    expect(signals[`0:${m1.sha}`]).toEqual(['branch']);
    expect(signals[`0:${s1.sha}`]).toEqual(['scope']);
    expect(signals[`0:${p1.sha}`]).toEqual(['path']);
    expect(signals[`1:${t1.sha}`]).toEqual(['text']);
    expect(signals[`0:${d1.sha}`]).toBeUndefined();
  });
  it('reports every change, newest first, with links and signals', () => {
    const ep = buildEpisode(cut, { identities: true, minCommits: 1 });
    expect(validateEpisode(ep)).toEqual([]);
    const rep = featureReport(ep, { name: 'rocketpad', collection: 'Team', signals });
    expect(rep).toMatchObject({ kind: 'feature', name: 'rocketpad', label: 'rocketpad', collection: 'Team', from: day(2), to: day(9) });
    expect(rep.totals.commits).toBe(7);
    expect(rep.totals.stories).toBe(2);
    expect(rep.totals.developers).toBe(2);
    expect(rep.changes).toHaveLength(7);
    expect(rep.changes[0]).toMatchObject({ repo: 'Beta', who: 'Bob', d: day(9), signals: ['text'], url: `https://example.test/acme/beta/commit/${t1.sha.slice(0, 12)}` });
    expect(rep.changes.find((c) => c.sha === b2.sha.slice(0, 12))).toMatchObject({ repo: 'Alpha', who: 'Bob', signals: ['via-merge'], title: 'tests for the loop' });
  });
  it('works on a single repository too', () => {
    const one = cutFeature(alpha, 'rocketpad');
    expect(one.history.commits).toHaveLength(6);
    const rep = featureReport(buildEpisode(one.history, { minCommits: 1 }), { name: 'rocketpad', collection: 'Solo', signals: one.signals });
    expect(rep.changes.every((c) => c.signals.length)).toBe(true);
  });
  it('finds nothing when no commit names the feature', () => {
    expect(cutFeature(combined, 'moonbase').history.commits).toEqual([]);
  });
});

describe('commit bodies in git log', () => {
  it('keeps the body, trimmed and clipped', () => {
    const long = 'x'.repeat(2500);
    const text = [
      '@@@aaa\x1f2025-01-02\x1fAda\x1fa@x\x1fp1\x1f\x1ffeat: cache\x1f',
      '',
      '  Needed by liveserve.  ',
      '\x1e',
      'src/a.js',
      `@@@bbb\x1f2025-01-01\x1fAda\x1fa@x\x1fp0\x1f\x1ffeat: long\x1f${long}\x1e`,
      '@@@ccc\x1f2025-01-01\x1fAda\x1fa@x\x1fp0\x1f\x1ffeat: none\x1f\x1e',
    ].join('\n');
    const h = parseGitLog(text);
    expect(h.commits[0].body).toBe('Needed by liveserve.');
    expect(h.commits[1].body).toHaveLength(2000);
    expect(h.commits[2].body).toBeUndefined();
  });
});
