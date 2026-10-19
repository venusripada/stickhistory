import { describe, it, expect, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkGitUrl, cloneRepo, fetchRepo, headOf, readHistory, repoMeta, GitSourceError } from '../src/index.js';
import { makeRepo, addCommits, tempDir, removeDir } from './make-repo.js';

const made = [];
const track = (d) => { made.push(d); return d; };
afterAll(() => made.forEach(removeDir));

describe('checkGitUrl', () => {
  it('accepts remote URLs and existing local repos', () => {
    expect(checkGitUrl('https://github.com/acme/rocket').url).toBe('https://github.com/acme/rocket');
    expect(checkGitUrl('git@github.com:acme/rocket.git').kind).toBe('remote');
    expect(checkGitUrl('github.com/acme/rocket').url).toBe('https://github.com/acme/rocket');
    const repo = track(makeRepo({ n: 2 }));
    const local = checkGitUrl(repo);
    expect(local.kind).toBe('local');
    expect(local.url).toBe(pathToFileURL(repo).href);
  });
  it('refuses options, odd transports and missing paths with readable errors', () => {
    expect(() => checkGitUrl('--upload-pack=touch /tmp/x')).toThrow(GitSourceError);
    expect(() => checkGitUrl('ext::sh -c touch% /tmp/x')).toThrow(/https, ssh/);
    expect(() => checkGitUrl('/no/such/folder/anywhere')).toThrow(/doesn't exist/);
    expect(() => checkGitUrl('')).toThrow(/link/);
  });
});

describe('repoMeta', () => {
  it('names repos and links back to their web page', () => {
    expect(repoMeta('https://github.com/acme/rocket.git')).toEqual({ owner: 'acme', name: 'rocket', webUrl: 'https://github.com/acme/rocket' });
    expect(repoMeta('git@gitlab.com:team/sub/tool.git')).toEqual({ owner: 'team/sub', name: 'tool', webUrl: 'https://gitlab.com/team/sub/tool' });
    expect(repoMeta('file:///tmp/x/my-repo')).toEqual({ owner: null, name: 'my-repo', webUrl: null });
  });
});

describe('clone, read and fetch', () => {
  const src = track(makeRepo({ n: 12, tagAt: { 5: 'v1.0.0' } }));
  const dest = join(track(tempDir()), 'repo.git');
  it('clones blobless and bare, with progress', async () => {
    const seen = [];
    await cloneRepo(checkGitUrl(src).url, dest, { onProgress: (p) => seen.push(p) });
    expect(existsSync(join(dest, 'HEAD'))).toBe(true);
    expect(existsSync(join(dest, '.git'))).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
  });
  it('reads the history, including issues from commit bodies and tags', async () => {
    const h = await readHistory(dest, { name: 'demo' });
    expect(h.commits).toHaveLength(12);
    expect(h.source).toBe('git-log');
    expect(h.repo.name).toBe('demo');
    expect(h.commits.some((c) => c.issues.length)).toBe(true);
    expect(h.commits.some((c) => c.tags.includes('v1.0.0'))).toBe(true);
    expect(h.commits.every((c) => c.files >= 1)).toBe(true);
  });
  it('fetches new commits and moves the head', async () => {
    const before = await headOf(dest);
    const newHead = addCommits(src, { n: 3, from: 12 });
    await fetchRepo(dest);
    const after = await headOf(dest);
    expect(after).toBe(newHead);
    expect(after).not.toBe(before);
    expect((await readHistory(dest)).commits).toHaveLength(15);
  });
  it('explains failures', async () => {
    const err = await cloneRepo(pathToFileURL(join(tempDir(), 'missing')).href, join(track(tempDir()), 'r.git')).catch((e) => e);
    expect(err).toBeInstanceOf(GitSourceError);
    expect(err.message).toMatch(/git couldn't/i);
  });
});
