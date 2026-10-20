// Bosses that spawn their work: pull requests merged with merge commits,
// releases, and Tech Debt. Made-up history only.

import { describe, it, expect } from 'vitest';
import { findPullRequests, buildEpisode, validateEpisode, TL } from '../src/index.js';

import { mergeHistory } from './fixtures-merge.js';

describe('findPullRequests', () => {
  it('finds the commits each merge brought in', () => {
    const prs = findPullRequests(mergeHistory().commits);
    expect([...prs.keys()].sort()).toEqual(['m12', 'm20', 'm24']);
    expect(prs.get('m12').sort()).toEqual(['pal0', 'pal1', 'pal2', 'pal3', 'pal4', 'pal5']);
    expect(prs.get('m24').sort()).toEqual(['tiny0', 'tiny1']);
  });
  it('finds nothing in a history without merges', () => {
    expect(findPullRequests([{ sha: 'a', parentShas: ['b'] }, { sha: 'b', parentShas: [] }]).size).toBe(0);
  });
});

describe('boss groups in an episode', () => {
  const ep = buildEpisode(mergeHistory());
  const tl = ep.timeline;
  const shaOf = (i) => tl.commits[i][TL.sha];
  it('validates', () => { expect(validateEpisode(ep)).toEqual([]); });
  it('makes a big feature pull request a feature boss that spawns its commits', () => {
    const f = tl.groups.filter((g) => g.kind === 'feature');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ title: 'Add the command palette', who: 'Ada' });
    expect(shaOf(f[0].at)).toBe('m12');
    expect(f[0].members.map(shaOf).sort()).toEqual(['pal0', 'pal1', 'pal2', 'pal3', 'pal4', 'pal5']);
  });
  it('does not make small or non-feature pull requests feature bosses', () => {
    const titles = tl.groups.filter((g) => g.kind === 'feature').map((g) => g.title);
    expect(titles).not.toContain('Two small fixes');
    expect(titles).not.toContain('Tidy the settings store');
  });
  it('makes a release a hive of everything since the previous one, except work that comes with a feature boss', () => {
    const r = tl.groups.filter((g) => g.kind === 'release');
    expect(r.map((g) => g.tag)).toEqual(['v0.1.0', 'v0.2.0']);
    const v2 = r[1];
    expect(v2.start).toBe(r[0].day + 1);
    const featureMembers = new Set(tl.groups.find((g) => g.kind === 'feature').members);
    for (const i of v2.members) {
      expect(tl.commits[i][TL.day]).toBeGreaterThanOrEqual(v2.start);
      expect(tl.commits[i][TL.day]).toBeLessThanOrEqual(v2.day);
      expect(featureMembers.has(i)).toBe(false);
      expect(['fix', 'feat']).toContain(tl.commits[i][TL.kind]);
    }
    expect(v2.members.length).toBeGreaterThan(0);
  });
  it('makes Tech Debt that came in as a pull request spawn that pull request\'s commits', () => {
    const d = tl.groups.filter((g) => g.kind === 'debt');
    const tidy = d.find((g) => shaOf(g.at) === 'm20');
    expect(tidy).toBeTruthy();
    expect(tidy.members.map(shaOf).sort()).toEqual(['tidy0', 'tidy1', 'tidy2', 'tidy3', 'tidy4', 'tidy5']);
  });
});
