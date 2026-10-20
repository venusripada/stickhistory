// Combining the stories of one collection into one history and episode.
// Made-up people and messages only.

import { describe, it, expect } from 'vitest';
import { combineHistories, buildEpisode, validateEpisode, releaseWeight, resolveIdentities, fixOf, commitUrl, peopleSummary, TL } from '../src/index.js';

const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86400000).toISOString().slice(0, 10);
function history(name, people, n, { offset = 0, tagAt = {} } = {}) {
  const commits = [];
  for (let i = 0; i < n; i++) {
    const [pname, email] = people[i % people.length];
    commits.push({
      sha: `${name}-${String(i).padStart(4, '0')}`.padEnd(40, '0'), date: day(i + offset),
      message: i % 3 === 0 ? `feat: ${name} thing ${i}` : `fix: ${name} bug ${i}`,
      author: { name: pname, email, login: null }, files: 2 + (i % 5), paths: [`src/${name}/f${i % 4}.js`], pr: null, issues: [],
      tags: tagAt[i] ? [tagAt[i]] : [], parents: 1,
    });
  }
  return { historyVersion: 1, repo: { owner: null, name, url: null, defaultBranch: 'main' }, source: 'git-log', truncated: false, commitLimit: null, totalCommits: n, fetchedAt: '2024-06-01T00:00:00Z', commits };
}

const ada = ['Ada Test', 'ada@work.test'];
const adaHome = ['Ada Test', 'ada@home.test'];
const bob = ['Bob Test', 'bob@work.test'];
const robert = ['Robert Test', 'rob@other.test'];
const alpha = history('alpha', [ada, bob], 30, { tagAt: { 10: 'v1.0.0' } });
const beta = history('beta', [adaHome, robert, ['beta', 'beta@ci.test']], 30, { offset: 5, tagAt: { 12: 'v1.0.0' } });
const combined = combineHistories([
  { history: alpha, name: 'Alpha', url: 'https://example.test/acme/alpha' },
  { history: beta, name: 'Beta', url: null },
], { name: 'Team' });

describe('combineHistories', () => {
  it('keeps every commit and marks which repo it came from', () => {
    expect(combined.commits).toHaveLength(60);
    expect(combined.repos).toEqual([{ name: 'Alpha', url: 'https://example.test/acme/alpha' }, { name: 'Beta', url: null }]);
    expect(combined.commits.filter((c) => c.repo === 0)).toHaveLength(30);
    expect(combined.source).toBe('collection');
    expect(combined.repo.name).toBe('Team');
  });
  it('labels release tags with their repo, and they still count as releases', () => {
    const tags = combined.commits.flatMap((c) => c.tags);
    expect(tags.sort()).toEqual(['Alpha v1.0.0', 'Beta v1.0.0']);
    expect(releaseWeight('Alpha v1.0.0')).toBe(3);
    expect(releaseWeight('Demo Repo v2.1.0')).toBe(2);
  });
  it('treats an author named after their own repo as a bot', () => {
    const ep = buildEpisode(combined);
    expect(ep.timeline.people.find((p) => p.name.startsWith('beta')).bot).toBe(true);
  });
});

describe('a collection episode', () => {
  const ep = buildEpisode(combined, { identities: true });
  const tl = ep.timeline;
  it('validates and lists its repos', () => {
    expect(validateEpisode(ep)).toEqual([]);
    expect(tl.repos.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    for (const c of tl.commits) expect([0, 1]).toContain(c[TL.repo]);
  });
  it('recognizes the same person across repos by name, and keeps the ways they appeared', () => {
    const adas = tl.people.filter((p) => p.name.startsWith('Ada'));
    expect(adas).toHaveLength(1);
    expect(adas[0].emails.sort()).toEqual(['ada@home.test', 'ada@work.test']);
    expect(adas[0].names).toEqual(['Ada Test']);
    const repos = new Set(tl.commits.filter((c) => tl.people[c[TL.who]] === adas[0]).map((c) => c[TL.repo]));
    expect([...repos].sort()).toEqual([0, 1]);
  });
  it('carries the repo into fix records and links to the right repo', () => {
    const i = tl.commits.findIndex((c) => c[TL.repo] === 0 && c[TL.kind] === 'fix');
    const fx = fixOf(tl, i);
    expect(fx).toMatchObject({ repo: 'Alpha', repoUrl: 'https://example.test/acme/alpha' });
    expect(commitUrl('https://wrong.test/x', fx)).toBe(`https://example.test/acme/alpha/commit/${fx.sha}`);
    const j = tl.commits.findIndex((c) => c[TL.repo] === 1);
    expect(commitUrl(null, fixOf(tl, j))).toBeNull();
  });
  it('single-repo episodes have no repo slot and still validate', () => {
    const one = buildEpisode(alpha);
    expect(one.timeline.repos).toBeUndefined();
    expect(one.timeline.commits[0]).toHaveLength(9);
    expect(fixOf(one.timeline, 0).repo).toBeNull();
  });
});

describe('merging and separating people by hand', () => {
  it('merges people the owner says are the same', () => {
    const ep = buildEpisode(combined, { identities: true, aliases: { Bob: ['Bob Test', 'bob@work.test', 'Robert Test', 'rob@other.test'] } });
    const bobs = ep.timeline.people.filter((p) => /Bob|Robert/.test(p.name));
    expect(bobs).toHaveLength(1);
    expect(bobs[0].name).toBe('Bob');
  });
  it('keeps apart people who only share a full name', () => {
    const ids = resolveIdentities(combined.commits, { separate: ['Ada Test'] });
    const adas = ids.people.filter((p) => p.fullName === 'Ada Test');
    expect(adas).toHaveLength(2);
    const ep = buildEpisode(combined, { identities: true, separate: ['Ada Test'] });
    expect(ep.timeline.people.filter((p) => p.names.includes('Ada Test'))).toHaveLength(2);
  });
});

describe('peopleSummary', () => {
  const ep = buildEpisode(combined, { identities: true });
  const tl = ep.timeline;
  it('lists developers busiest first, with their work per repo, and leaves bots out', () => {
    const list = peopleSummary(tl);
    expect(list.every((p) => !p.bot)).toBe(true);
    for (let i = 1; i < list.length; i++) expect(list[i - 1].commits).toBeGreaterThanOrEqual(list[i].commits);
    const ada = list.find((p) => p.name.startsWith('Ada'));
    const mine = tl.commits.filter((c) => tl.people[c[TL.who]].name === ada.name);
    expect(ada.commits).toBe(mine.length);
    expect(ada.fixes).toBe(mine.filter((c) => c[TL.kind] === 'fix').length);
    expect(ada.feats).toBe(mine.filter((c) => c[TL.kind] === 'feat').length);
    expect(ada.repos).toEqual([{ name: 'Alpha', commits: mine.filter((c) => c[TL.repo] === 0).length }, { name: 'Beta', commits: mine.filter((c) => c[TL.repo] === 1).length }].sort((a, b) => b.commits - a.commits));
    expect(ada.emails).toEqual(['ada@home.test', 'ada@work.test']);
    expect(ada.first <= ada.last).toBe(true);
  });
});
