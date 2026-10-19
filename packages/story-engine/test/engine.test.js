import { describe, it, expect } from 'vitest';
import { buildEpisode, validateEpisode, parseGitLog, kindOf, enemyTypeOf, splitChapters, resolveIdentities, releaseWeight, areaOf, closingIssues, cleanTitle, isCleanup } from '../src/index.js';
import { syntheticHistory } from './fixtures.js';

describe('classification', () => {
  it('reads conventional commits, keywords and labels', () => {
    expect(kindOf('fix(tui): cursor jump')).toBe('fix');
    expect(kindOf('feat: palette')).toBe('feat');
    expect(kindOf('Revert "feat: palette"')).toBe('revert');
    expect(kindOf('refactor(core): split')).toBe('refactor');
    expect(kindOf('Handle empty config', ['bug'])).toBe('fix');
    expect(kindOf('Update readme')).toBe('other');
  });
  it('picks enemy types from labels first, then words, then paths', () => {
    expect(enemyTypeOf('fix: something', '', ['crash'])).toBe('bomb');
    expect(enemyTypeOf('fix: app hangs on start')).toBe('bomb');
    expect(enemyTypeOf('fix: windows path quoting')).toBe('wraith');
    expect(enemyTypeOf('fix: memory leak')).toBe('beetle');
    expect(enemyTypeOf('fix: sidebar layout')).toBe('moth');
    expect(enemyTypeOf('fix: wrong value', 'packages/tui')).toBe('gremlin');
    expect(enemyTypeOf('fix: wrong value', 'packages/core')).toBe('crawler');
  });
  it('drops trailing closing references from titles', () => {
    expect(cleanTitle('Fix setting of multiple cookies. Closes #199')).toBe('setting of multiple cookies');
    expect(cleanTitle('fix: route chaining regression. Closes #1397 [reported by Tr]')).toBe('route chaining regression');
    expect(cleanTitle('fix: crash when todo content is empty fixes #2622')).toBe('crash when todo content is empty');
    expect(cleanTitle('fix(docs): styles and zen doc, closes #2912 (#3000)')).toBe('styles and zen doc');
    expect(cleanTitle('Fix #7 crash on start')).toBe('#7 crash on start');
  });
  it('finds the main area of a change', () => {
    expect(areaOf(['packages/tui/a.ts', 'packages/tui/b.ts', 'README.md'])).toBe('packages/tui');
    expect(areaOf(['docs/a.md'])).toBe('docs');
    expect(areaOf(null)).toBe('');
  });
});

describe('isCleanup (what counts as paying off tech debt)', () => {
  it('counts refactors, removals, migrations and consolidations', () => {
    expect(isCleanup('refactor(desktop): consolidate desktop-electron into desktop package (#25822)', 'refactor')).toBe(true);
    expect(isCleanup('refactor(packages): migrate to the opencode npm scope (#47852)', 'refactor')).toBe(true);
    expect(isCleanup('remove outdated SDKs', 'other')).toBe(true);
    expect(isCleanup('removed packages/opencode', 'other')).toBe(true);
    expect(isCleanup('chore: delete unused files', 'other')).toBe(true);
    expect(isCleanup('Restructure the plugin loader', 'other')).toBe(true);
    expect(isCleanup('drop deprecated v1 API', 'other')).toBe(true);
  });
  it('does not count features, docs, translations, work in progress, syncs or dependency bumps', () => {
    expect(isCleanup('sync', 'other')).toBe(false);
    expect(isCleanup('enterprise (#4617)', 'other')).toBe(false);
    expect(isCleanup('wip(docs): i18n (#12681)', 'other')).toBe(false);
    expect(isCleanup('zen: track session in usage', 'other')).toBe(false);
    expect(isCleanup('docs: remove old guide', 'other')).toBe(false);
    expect(isCleanup('chore(deps): upgrade react to 19', 'other')).toBe(false);
    expect(isCleanup('feat: remove legacy login in favor of SSO', 'feat')).toBe(false);
    expect(isCleanup('fix: remove crash on start', 'fix')).toBe(false);
    expect(isCleanup('Merge branch main into cleanup', 'merge')).toBe(false);
  });
});

describe('identities', () => {
  it('merges aliases by email, noreply login and hand-written aliases', () => {
    const commits = [
      { author: { name: 'Dax Raad', email: 'd@x.co', login: null } },
      { author: { name: 'Dax', email: 'd@x.co', login: null } },
      { author: { name: 'thdxr', email: '123+thdxr@users.noreply.github.com', login: null } },
      { author: { name: 'Someone Else', email: 'se@x.co', login: null } },
    ];
    const ids = resolveIdentities(commits, { aliases: { Dax: ['thdxr'] }, preferLogin: false });
    const names = commits.map((c) => ids.personOf(c).name);
    expect(names.slice(0, 3)).toEqual(['Dax', 'Dax', 'Dax']);
    expect(names[3]).toBe('Someone');
  });
  it('flags bots, including commits made as the project itself', () => {
    const commits = [
      { author: { name: 'github-actions[bot]', email: 'x', login: null } },
      { author: { name: 'rocket', email: 'release@rocket.dev', login: null } },
      { author: { name: 'Ada', email: 'ada@x', login: null } },
    ];
    const ids = resolveIdentities(commits, { repoName: 'rocket' });
    expect(commits.map((c) => ids.personOf(c).bot)).toEqual([true, true, false]);
  });
});

describe('chapters', () => {
  it('weights release tags', () => {
    expect(releaseWeight('v2.0.0')).toBe(3);
    expect(releaseWeight('1.4.0')).toBe(2);
    expect(releaseWeight('v1.4.2')).toBe(1);
    expect(releaseWeight('nightly-2024')).toBe(0);
  });
  it('snaps a boundary to a nearby release', () => {
    const commits = Array.from({ length: 300 }, (_, i) => ({ tags: i === 160 ? ['v1.0.0'] : [] }));
    const parts = splitChapters(commits, { chapters: 2 });
    expect(parts).toHaveLength(2);
    expect(parts[0].end).toBe(161);
    expect(parts[0].release).toBe('v1.0.0');
    expect(parts[1].start).toBe(161);
  });
  it('covers every commit exactly once', () => {
    const commits = Array.from({ length: 5000 }, (_, i) => ({ tags: i % 400 === 0 ? [`v1.${i / 400}.0`] : [] }));
    const parts = splitChapters(commits);
    expect(parts[0].start).toBe(0);
    expect(parts[parts.length - 1].end).toBe(5000);
    for (let i = 1; i < parts.length; i++) expect(parts[i].start).toBe(parts[i - 1].end);
  });
});

describe('buildEpisode', () => {
  it('produces a valid episode', () => {
    const ep = buildEpisode(syntheticHistory({ withPr: true, withIssues: true }), { generatedAt: 'x' });
    expect(validateEpisode(ep)).toEqual([]);
    expect(ep.summary.repo).toBe('acme/rocket');
    expect(ep.chapters.length).toBeGreaterThanOrEqual(3);
    expect(ep.roster.length).toBeGreaterThan(0);
    expect(ep.summary.botCommits).toBeGreaterThan(0);
    for (const ch of ep.chapters) for (const h of ch.heroes) expect(h.name).not.toMatch(/bot/);
  });
  it('is deterministic and order-independent', () => {
    const a = buildEpisode(syntheticHistory({ withPr: true }), { generatedAt: 'x' });
    const b = buildEpisode(syntheticHistory({ withPr: true, newestFirst: true }), { generatedAt: 'x' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('prefers fixes linked to an issue for duels and titles them by the issue', () => {
    const ep = buildEpisode(syntheticHistory({ withPr: true, withIssues: true }), { generatedAt: 'x' });
    const duels = ep.chapters.flatMap((c) => c.heroes.map((h) => h.duel)).filter(Boolean);
    const linked = duels.filter((d) => d.issues.length);
    expect(linked.length).toBeGreaterThan(duels.length / 2);
    for (const d of linked) expect(d.t).toMatch(/^Bug report/);
    expect(ep.summary.issuesLinked).toBeGreaterThan(0);
  });
  it('uses GitHub logins as names in API mode and first names in git mode', () => {
    const api = buildEpisode(syntheticHistory({}), { generatedAt: 'x' });
    expect(api.roster.map((r) => r.name)).toContain('ada');
    const git = buildEpisode(syntheticHistory({ logins: false }), { generatedAt: 'x' });
    expect(git.roster.map((r) => r.name)).toContain('Ada');
  });
  it('ends a chapter on the v1.0.0 release', () => {
    const ep = buildEpisode(syntheticHistory({}), { generatedAt: 'x' });
    expect(ep.chapters.some((c) => c.release && c.release.tag === 'v1.0.0')).toBe(true);
  });
  it('only makes real cleanups the chapter boss', () => {
    const ep = buildEpisode(syntheticHistory());
    const bosses = ep.chapters.map((c) => c.boss).filter(Boolean);
    expect(bosses.length).toBeGreaterThan(0);
    for (const b of bosses) expect(isCleanup(b.s, 'refactor') || /^refactor/.test(b.s)).toBe(true);
    for (const b of bosses) expect(b.s).not.toMatch(/^(feat|docs|chore)/);
  });
  it('still builds a boss when file counts are unknown', () => {
    const h = syntheticHistory({});
    h.source = 'github-rest';
    h.commits.forEach((c) => { c.files = null; });
    const ep = buildEpisode(h, { generatedAt: 'x' });
    expect(validateEpisode(ep)).toEqual([]);
    expect(ep.chapters.some((c) => c.boss)).toBe(true);
    expect(ep.summary.note).toMatch(/without a GitHub token/);
  });
  it('rejects tiny histories with a readable message', () => {
    const h = syntheticHistory({ n: 5 });
    expect(() => buildEpisode(h)).toThrow(/at least 10/);
  });
});

describe('parseGitLog', () => {
  it('reads the documented format with tags, emails and files', () => {
    const text = [
      '@@@aaa111\x1f2025-01-02\x1fAda\x1fada@x.com\x1fp1\x1fHEAD -> main, tag: v1.0.0\x1ffix(tui): cursor (#12)',
      'packages/tui/a.ts',
      'packages/tui/b.ts',
      '',
      '@@@bbb222\x1f2025-01-01\x1fGrace\x1fg@x.com\x1fp0 p9\x1f\x1fMerge branch x',
    ].join('\n');
    const h = parseGitLog(text, { repoName: 'r' });
    expect(h.commits).toHaveLength(2);
    expect(h.commits[0]).toMatchObject({ sha: 'aaa111', files: 2, tags: ['v1.0.0'], message: 'fix(tui): cursor (#12)', parents: 1 });
    expect(h.commits[0].author.email).toBe('ada@x.com');
    expect(h.commits[1].parents).toBe(2);
  });
  it('still reads the older pipe format', () => {
    const h = parseGitLog('@@@abc|2025-01-01|Ada|tag: v0.1.0|feat: start|ish\nsrc/a.js\n');
    expect(h.commits[0]).toMatchObject({ sha: 'abc', message: 'feat: start|ish', files: 1, tags: ['v0.1.0'] });
  });
  it('reads closing issues from commit bodies and keeps file counts', () => {
    const text = [
      '@@@aaa111\x1f2025-01-02\x1fAda\x1fada@x.com\x1fp1\x1f\x1ffix(tui): cursor (#12)\x1fThe cursor jumped.',
      '',
      'Fixes #40, closes: #41',
      '@@@ this line is body text, not a commit',
      '\x1e',
      '',
      'packages/tui/a.ts',
      'packages/tui/b.ts',
      '@@@bbb222\x1f2025-01-01\x1fGrace\x1fg@x.com\x1fp0\x1f\x1fFix #7 crash on start\x1f\x1e',
      '',
      'src/main.js',
    ].join('\n');
    const h = parseGitLog(text, { repoName: 'r' });
    expect(h.commits).toHaveLength(2);
    expect(h.commits[0]).toMatchObject({ sha: 'aaa111', message: 'fix(tui): cursor (#12)', files: 2 });
    expect(h.commits[0].issues).toEqual([{ number: 40, title: null, labels: [] }, { number: 41, title: null, labels: [] }]);
    expect(h.commits[1]).toMatchObject({ sha: 'bbb222', files: 1 });
    expect(h.commits[1].issues.map((i) => i.number)).toEqual([7]);
  });
  it('leaves issues empty when the log has no bodies', () => {
    const h = parseGitLog('@@@aaa\x1f2025-01-02\x1fAda\x1fa@x\x1fp1\x1f\x1ffix: thing, fixes #3\nsrc/a.js\n');
    expect(h.commits[0].issues.map((i) => i.number)).toEqual([3]);
    const old = parseGitLog('@@@abc|2025-01-01|Ada||fix: start\nsrc/a.js\n');
    expect(old.commits[0].issues).toEqual([]);
  });
});

describe('closingIssues', () => {
  it('uses GitHub closing keywords only', () => {
    expect(closingIssues('Fixes #1. Resolved #2; close #3 and fixed: #4').map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(closingIssues('fix: thing (#12)\nSee #5, refs #6, related to #7')).toEqual([]);
    expect(closingIssues('prefix #8 and suffixes #9')).toEqual([]);
  });
  it('dedupes and keeps first-mention order', () => {
    expect(closingIssues('fixes #9\ncloses #2\nfixes #9').map((i) => i.number)).toEqual([9, 2]);
  });
  it('accepts references to the same repo and ignores other repos', () => {
    const repo = { owner: 'acme', name: 'rocket' };
    const body = 'Fixes acme/rocket#10, fixes other/thing#11, closes https://github.com/acme/rocket/issues/12, closes https://github.com/x/y/issues/13';
    expect(closingIssues(body, repo).map((i) => i.number)).toEqual([10, 12]);
    expect(closingIssues('Fixes acme/rocket#10').map((i) => i.number)).toEqual([]);
  });
});

describe('git-log issue links', () => {
  const fixRecords = (ep) => {
    const out = [];
    const walk = (v) => { if (v && typeof v === 'object') { if (typeof v.sha === 'string' && Array.isArray(v.issues)) out.push(v); Object.values(v).forEach(walk); } };
    walk(ep);
    return out;
  };
  it('links issues without titles and titles the duel by the commit', () => {
    const h = syntheticHistory({ logins: false });
    h.source = 'git-log';
    for (const [i, c] of h.commits.entries()) if (c.message.startsWith('fix') && i % 2 === 0) c.issues = [{ number: 900 + i, title: null, labels: [] }];
    const ep = buildEpisode(h);
    expect(validateEpisode(ep)).toEqual([]);
    const linked = fixRecords(ep).filter((f) => f.issues.length);
    expect(linked.length).toBeGreaterThan(0);
    for (const f of linked) {
      expect(f.issues[0].title).toBeNull();
      expect(f.t).not.toMatch(/null|undefined/);
      expect(f.t.length).toBeGreaterThan(0);
    }
    expect(ep.summary.issuesLinked).toBeGreaterThan(0);
  });
});

describe('validateEpisode', () => {
  it('explains what is wrong', () => {
    expect(validateEpisode(null)[0]).toMatch(/not an object/);
    expect(validateEpisode({ schemaVersion: 3, summary: {}, chapters: [], roster: [] }).join(' ')).toMatch(/schemaVersion/);
  });
});
