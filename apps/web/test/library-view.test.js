import { describe, it, expect } from 'vitest';
import { statusOf, filterStories, paginate, STATUSES, parseLibraryState, libraryStateHash } from '../src/library-view.js';

const st = (o) => ({ slug: o.name.toLowerCase(), setUp: true, hasEpisode: true, status: 'ready', url: `git@github.com:acme/${o.name}.git`, webUrl: `https://github.com/acme/${o.name}`, commits: 10, fetchedAt: '2026-01-01T00:00:00Z', last: '2025-12-01', ...o });
const stories = [
  st({ name: 'api', commits: 500, last: '2026-02-01' }),
  st({ name: 'web', commits: 50, fetchedAt: '2026-03-01T00:00:00Z' }),
  st({ name: 'worker', status: 'building', hasEpisode: false }),
  st({ name: 'queued-one', status: 'queued', hasEpisode: false }),
  st({ name: 'broken', status: 'error', hasEpisode: false, error: 'git could not find it' }),
  st({ name: 'empty', status: 'ready', hasEpisode: false }),
];

describe('statusOf', () => {
  it('sorts stories into ready, building, failed and not built', () => {
    expect(stories.map(statusOf)).toEqual(['ready', 'ready', 'building', 'building', 'failed', 'unbuilt']);
    expect(STATUSES.map((s) => s.key)).toEqual(['all', 'ready', 'building', 'failed', 'unbuilt']);
  });
});

describe('filterStories', () => {
  it('matches the name and the repo link, ignoring case', () => {
    expect(filterStories(stories, { q: 'API' }).map((s) => s.name)).toEqual(['api']);
    expect(filterStories(stories, { q: 'acme/web' }).map((s) => s.name)).toEqual(['web']);
    expect(filterStories(stories, { q: '  ' })).toHaveLength(6);
  });
  it('filters by status', () => {
    expect(filterStories(stories, { status: 'building' }).map((s) => s.name)).toEqual(['queued-one', 'worker']);
    expect(filterStories(stories, { status: 'failed' }).map((s) => s.name)).toEqual(['broken']);
  });
  it('sorts by name, commits, last update or last activity', () => {
    expect(filterStories(stories, { sort: 'name' })[0].name).toBe('api');
    expect(filterStories(stories, { sort: 'commits' })[0].name).toBe('api');
    expect(filterStories(stories, { sort: 'updated' })[0].name).toBe('web');
    expect(filterStories(stories, { sort: 'active' })[0].name).toBe('api');
  });
});

describe('paginate', () => {
  const many = Array.from({ length: 130 }, (_, i) => i);
  it('cuts a list into pages and keeps the page in range', () => {
    expect(paginate(many, 1, 60)).toMatchObject({ page: 1, pages: 3, from: 0, to: 60 });
    expect(paginate(many, 3, 60).items).toHaveLength(10);
    expect(paginate(many, 9, 60).page).toBe(3);
    expect(paginate([], 2, 60)).toMatchObject({ page: 1, pages: 1, items: [] });
  });
});

describe('library state in the address', () => {
  it('round-trips search, status, sort and pages', () => {
    const state = { q: 'api svc', status: 'failed', sort: 'commits', pages: { sailthru: 3 } };
    const hash = libraryStateHash(state);
    expect(hash).toBe('#/?q=api+svc&status=failed&sort=commits&page.sailthru=3');
    expect(parseLibraryState(hash)).toEqual(state);
    expect(libraryStateHash({ q: '', status: 'all', sort: 'name', pages: { a: 1 } })).toBe('#/');
    expect(parseLibraryState('#/')).toEqual({ q: '', status: 'all', sort: 'name', pages: {} });
  });
});
