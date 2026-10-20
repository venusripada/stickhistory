import { describe, it, expect, vi } from 'vitest';
import { fetchHistory, parseRepoUrl, GitHubError } from '../src/index.js';
import { buildEpisode, validateEpisode } from '../../story-engine/src/index.js';

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });

describe('parseRepoUrl', () => {
  it.each([
    ['anomalyco/opencode', 'anomalyco', 'opencode', null],
    ['https://github.com/anomalyco/opencode', 'anomalyco', 'opencode', null],
    ['github.com/anomalyco/opencode/', 'anomalyco', 'opencode', null],
    ['https://github.com/anomalyco/opencode/tree/dev', 'anomalyco', 'opencode', 'dev'],
    ['https://github.com/anomalyco/opencode/pull/12', 'anomalyco', 'opencode', null],
    ['git@github.com:anomalyco/opencode.git', 'anomalyco', 'opencode', null],
    ['https://www.github.com/a/b.git', 'a', 'b', null],
  ])('%s', (input, owner, repo, branch) => {
    expect(parseRepoUrl(input)).toEqual({ owner, repo, branch });
  });
  it('explains bad input', () => {
    expect(() => parseRepoUrl('')).toThrow(/Paste a GitHub/);
    expect(() => parseRepoUrl('https://gitlab.com/a/b')).toThrow(/Only github.com/);
    expect(() => parseRepoUrl('https://github.com/onlyowner')).toThrow(/missing the repository/);
  });
});

function gqlCommit(i, extra = {}) {
  return {
    oid: `sha${String(i).padStart(4, '0')}`,
    committedDate: new Date(Date.UTC(2025, 0, 1) + i * 3600e3 * 12).toISOString(),
    messageHeadline: i % 3 === 0 ? `fix(tui): bug number ${i} (#${100 + i})` : `feat: thing ${i} (#${100 + i})`,
    changedFilesIfAvailable: (i % 9) + 1,
    parents: { totalCount: 1 },
    author: { name: `Dev ${i % 4}`, email: `dev${i % 4}@x.com`, user: { login: `dev${i % 4}`, avatarUrl: `https://avatars/${i % 4}` } },
    associatedPullRequests: { nodes: [{ number: 100 + i, title: 't', merged: true, labels: { nodes: i % 3 === 0 ? [{ name: 'bug' }] : [] }, closingIssuesReferences: { nodes: i % 6 === 0 ? [{ number: 9000 + i, title: `Issue ${i}: thing is broken`, labels: { nodes: [{ name: 'crash' }] } }] : [] } }] },
    ...extra,
  };
}

function graphqlServer({ total = 150, failFirstPageOnce = false } = {}) {
  const all = Array.from({ length: total }, (_, i) => gqlCommit(total - 1 - i)); // newest first, like GitHub
  let failed = false;
  const calls = [];
  const fetch = vi.fn(async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query: query.slice(0, 40), variables });
    expect(init.headers.Authorization).toBe('Bearer tkn');
    if (query.includes('defaultBranchRef')) return json({ data: { repository: { nameWithOwner: 'acme/rocket', url: 'https://github.com/acme/rocket', isPrivate: false, defaultBranchRef: { name: 'main' } }, rateLimit: { remaining: 4999 } } });
    if (query.includes('history(')) {
      if (failFirstPageOnce && !failed) { failed = true; return new Response('timeout', { status: 502 }); }
      const start = variables.after ? Number(variables.after) : 0;
      const nodes = all.slice(start, start + variables.first);
      const end = start + nodes.length;
      return json({ data: { repository: { ref: { target: { history: { totalCount: total, pageInfo: { hasNextPage: end < total, endCursor: String(end) }, nodes } } } } }, rateLimit: { cost: 1, remaining: 4990 } });
    }
    if (query.includes('refs(')) return json({ data: { repository: { refs: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ name: 'v1.0.0', target: { __typename: 'Tag', target: { __typename: 'Commit', oid: 'sha0075' } } }, { name: 'v0.1.0', target: { __typename: 'Commit', oid: 'sha0020' } }] } } } });
    throw new Error('unexpected query');
  });
  return { fetch, calls };
}

describe('fetchHistory with a token (GraphQL)', () => {
  it('pages through history and maps PRs, issues, files and tags', async () => {
    const { fetch } = graphqlServer({ total: 150 });
    const progress = [];
    const h = await fetchHistory({ url: 'github.com/acme/rocket', token: 'tkn', fetch, onProgress: (p) => progress.push(p) });
    expect(h.source).toBe('github-graphql');
    expect(h.commits).toHaveLength(150);
    expect(h.truncated).toBe(false);
    expect(h.repo).toMatchObject({ owner: 'acme', name: 'rocket', defaultBranch: 'main' });
    const c0 = h.commits.find((c) => c.sha === 'sha0000');
    expect(c0.author.login).toBe('dev0');
    expect(c0.files).toBe(1);
    expect(c0.pr.issues[0]).toMatchObject({ number: 9000, labels: ['crash'] });
    expect(h.tags).toEqual([{ name: 'v1.0.0', sha: 'sha0075' }, { name: 'v0.1.0', sha: 'sha0020' }]);
    expect(progress.some((p) => p.phase === 'commits' && p.fetched === 150)).toBe(true);
    // and the story engine accepts it
    const ep = buildEpisode(h, { generatedAt: 'x' });
    expect(validateEpisode(ep)).toEqual([]);
    expect(ep.summary.issuesLinked).toBeGreaterThan(0);
    expect(ep.roster[0].avatarUrl).toMatch(/avatars/);
    const crashDuel = ep.chapters.flatMap((c) => c.heroes.map((x) => x.duel)).find((d) => d && d.issues.length);
    expect(crashDuel.type).toBe('bomb');
  });
  it('stops at maxCommits and marks the history truncated', async () => {
    const { fetch } = graphqlServer({ total: 150 });
    const h = await fetchHistory({ owner: 'acme', repo: 'rocket', token: 'tkn', fetch, maxCommits: 120 });
    expect(h.commits).toHaveLength(120);
    expect(h.truncated).toBe(true);
    expect(h.totalCommits).toBe(150);
  });
  it('retries a timed-out page with a smaller size', async () => {
    const { fetch, calls } = graphqlServer({ total: 60, failFirstPageOnce: true });
    vi.useFakeTimers();
    const p = fetchHistory({ owner: 'acme', repo: 'rocket', token: 'tkn', fetch });
    await vi.runAllTimersAsync();
    const h = await p;
    vi.useRealTimers();
    expect(h.commits).toHaveLength(60);
    expect(calls.some((c) => c.variables.first === 100)).toBe(true);
  });
  it('turns NOT_FOUND into a readable message', async () => {
    const fetch = vi.fn(async () => json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] }));
    await expect(fetchHistory({ owner: 'a', repo: 'b', token: 'tkn', fetch })).rejects.toThrow(/wasn't found, or this token can't see it/);
  });
  it('explains a rejected token', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(fetchHistory({ owner: 'a', repo: 'b', token: 'tkn', fetch })).rejects.toThrow(/rejected the token/);
  });
  it('can be cancelled', async () => {
    const { fetch } = graphqlServer({ total: 500 });
    const ac = new AbortController();
    const p = fetchHistory({ owner: 'acme', repo: 'rocket', token: 'tkn', fetch, signal: ac.signal, onProgress: (e) => { if (e.phase === 'commits') ac.abort(); } });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchHistory without a token (REST)', () => {
  function restServer({ commits = 230, rateLimited = false } = {}) {
    const all = Array.from({ length: commits }, (_, i) => ({
      sha: `r${commits - i}`,
      commit: { message: `fix: thing ${i}\n\nbody`, author: { name: `Dev ${i % 3}`, email: `d${i % 3}@x`, date: new Date(Date.UTC(2025, 5, 1) - i * 864e5).toISOString() }, committer: { date: new Date(Date.UTC(2025, 5, 1) - i * 864e5).toISOString() } },
      author: { login: `dev${i % 3}`, avatar_url: 'https://a' },
      parents: [{}],
    }));
    return vi.fn(async (url) => {
      const u = new URL(url);
      if (rateLimited) return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800) } });
      if (u.pathname === '/repos/acme/rocket') return json({ default_branch: 'main', html_url: 'https://github.com/acme/rocket' });
      if (u.pathname.endsWith('/commits')) {
        const page = Number(u.searchParams.get('page')), per = Number(u.searchParams.get('per_page'));
        const items = all.slice((page - 1) * per, page * per);
        const last = Math.ceil(all.length / per);
        return json(items, { headers: { link: `<https://api.github.com/x?page=${last}>; rel="last"`, 'x-ratelimit-remaining': '50' } });
      }
      if (u.pathname.endsWith('/tags')) return json([{ name: 'v1.0.0', commit: { sha: 'r100' } }]);
      return new Response('{}', { status: 404 });
    });
  }
  it('reads commits page by page and keeps only the subject line', async () => {
    const fetch = restServer({ commits: 230 });
    const h = await fetchHistory({ url: 'acme/rocket', fetch });
    expect(h.source).toBe('github-rest');
    expect(h.commits).toHaveLength(230);
    expect(h.commits[0].message).toBe('fix: thing 0');
    expect(h.commits[0].files).toBeNull();
    expect(h.tags).toEqual([{ name: 'v1.0.0', sha: 'r100' }]);
    const ep = buildEpisode(h, { generatedAt: 'x' });
    expect(validateEpisode(ep)).toEqual([]);
  });
  it('reports the rate limit with when it resets and what to do', async () => {
    const fetch = restServer({ rateLimited: true });
    const err = await fetchHistory({ url: 'acme/rocket', fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.code).toBe('rate-limit');
    expect(err.message).toMatch(/resets in about 30 minutes\. Add a token/);
  });
  it('explains a missing or private repo', async () => {
    const fetch = vi.fn(async () => new Response('{"message":"Not Found"}', { status: 404 }));
    await expect(fetchHistory({ url: 'acme/nope', fetch })).rejects.toThrow(/acme\/nope wasn't found\. If it's private/);
  });
});
