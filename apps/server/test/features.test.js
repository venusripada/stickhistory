// Features of a collection: every commit, across the stories, that names a
// feature, as a movie and a report kept in the library folder.
// Generated repos with made-up people, messages and paths only.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { startServer } from '../src/server.js';
import { makeRepo, mergePullRequest, tempDir, removeDir } from '@commit-wars/git-source/test-repo';

vi.setConfig({ testTimeout: 30000 });

let srv, root, web;
const dirs = [];
const call = async (method, path, body) => {
  const res = await fetch(srv.url + path, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
};
const colInfo = async () => (await call('GET', '/api/library')).json.collections.find((c) => c.slug === 'team');
async function until(fn, what, timeout = 25000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 80));
  }
}
const featureDone = (id, not = null) => until(async () => { const f = (await colInfo()).features.find((x) => x.id === id); return f && ['ready', 'small', 'error'].includes(f.status) && f.builtAt !== not ? f : null; }, `feature ${id}`);

/** One commit with a subject, an optional body and one file. */
function commit(dir, { subject, body = '', file = 'src/x.txt', day }) {
  const p = join(dir, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${subject}\n`);
  const date = `${day}T12:00:00Z`;
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=Cy Test', '-c', 'user.email=cy@example.test', 'commit', '-q', '-m', subject, ...(body ? ['-m', body] : [])], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

beforeAll(async () => {
  root = tempDir('cw-feat-'); web = tempDir('cw-web-'); dirs.push(root, web);
  mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>Commit Wars</title><script type="module" crossorigin src="./assets/app.js"></script><link rel="stylesheet" crossorigin href="./assets/app.css"><main></main>');
  writeFileSync(join(web, 'assets', 'app.js'), 'document.title = "app";');
  writeFileSync(join(web, 'assets', 'app.css'), 'main{color:red}');
  srv = await startServer({ port: 0, library: root, quiet: true, staticDir: web });
  const a = makeRepo({ n: 12, start: '2024-03-01' });
  mergePullRequest(a, { name: 'rocketpad-retries', n: 3, pr: 9, title: 'Retries', day: '2024-03-20' });
  commit(a, { subject: 'feat(rocketpad): keys', day: '2024-03-22' });
  commit(a, { subject: 'chore: move files', file: 'services/rocketpad/a.txt', day: '2024-03-23' });
  commit(a, { subject: 'feat: rocketpadder decoy', day: '2024-03-24' });
  const b = makeRepo({ n: 12, start: '2024-03-01' });
  commit(b, { subject: 'fix: cache misses', body: 'Seen in RocketPad.', day: '2024-03-25' });
  dirs.push(a, b);
  await call('POST', '/api/collections', { name: 'Team' });
  await call('POST', '/api/collections/team/stories', { url: a, name: 'Alpha' });
  await call('POST', '/api/collections/team/stories', { url: b, name: 'Beta' });
  await until(async () => { const c = await colInfo(); return c.episode && c.episode.status === 'ready' && c.episode.repos === 2 ? c : null; }, 'the collection movie');
});
afterAll(async () => { await srv.close(); dirs.forEach(removeDir); });

describe('features of a collection', () => {
  it('finds a feature across the stories and keeps its report in the collection folder', async () => {
    expect((await colInfo()).features).toEqual([]);
    const r = await call('POST', '/api/collections/team/features', { name: 'RocketPad' });
    expect(r.status).toBe(202);
    expect(r.json.feature).toMatchObject({ id: 'rocketpad', name: 'RocketPad' });
    const f = await featureDone('rocketpad');
    // the merge, its 3 commits, the scope, the path, the body mention; not the decoy
    expect(f).toMatchObject({ status: 'small', commits: 7, hasReport: true, hasEpisode: false, from: '2024-03-20', to: '2024-03-25' });
    for (const x of ['feature.json', 'report.json']) expect(existsSync(join(root, 'team', '_features', 'rocketpad', x))).toBe(true);
    const rep = (await call('GET', '/api/collections/team/features/rocketpad/report')).json;
    expect(rep).toMatchObject({ kind: 'feature', name: 'RocketPad', collection: 'Team', totals: { commits: 7, stories: 2 } });
    expect(rep.changes.map((c) => c.signals.join(','))).toEqual(['text', 'path', 'scope', 'branch', 'text,path,via-merge', 'text,path,via-merge', 'text,path,via-merge']);
    expect(rep.changes.map((c) => c.title)).not.toContain('rocketpadder decoy');
    expect((await colInfo()).stories.map((s) => s.slug).sort()).toEqual(['alpha', 'beta']);
  });

  it('returns the same feature when its name is given again', async () => {
    const again = await call('POST', '/api/collections/team/features', { name: 'RocketPad' });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ feature: { id: 'rocketpad' }, job: null });
  });

  it('says why a feature has nothing in it', async () => {
    await call('POST', '/api/collections/team/features', { name: 'moonbase' });
    const f = await featureDone('moonbase');
    expect(f.status).toBe('error');
    expect(f.error).toMatch(/No commits in this collection mention "moonbase"/);
  });

  it('refuses names that aren\'t a feature, and ids that leave the folder', async () => {
    const r = await call('POST', '/api/collections/team/features', { name: 'a/b' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/can't be a feature name/);
    expect((await call('GET', '/api/collections/team/features/..%2F..%2Fx/report')).status).toBe(404);
    expect((await call('GET', '/api/collections/team/features/nope/report')).status).toBe(404);
  });

  it('downloads a feature as one .html file with its report inside', async () => {
    const r = await call('GET', '/api/collections/team/features/rocketpad/share');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="Team-RocketPad.commit-wars.html"');
    const data = JSON.parse(r.text.match(/window\.__CW_SHARE__=(.*?);<\/script>/)[1]);
    expect(data.report.kind).toBe('feature');
    expect(data.episode).toBe(null);
  });

  it('builds a feature again, and deletes it', async () => {
    const before = (await colInfo()).features.find((x) => x.id === 'rocketpad').builtAt;
    expect((await call('POST', '/api/collections/team/features/rocketpad/rebuild', {})).status).toBe(202);
    await featureDone('rocketpad', before);
    expect((await call('DELETE', '/api/collections/team/features/moonbase')).status).toBe(200);
    expect(existsSync(join(root, 'team', '_features', 'moonbase'))).toBe(false);
    expect((await colInfo()).features.map((f) => f.id)).not.toContain('moonbase');
  });

  it('is found again after the collection movie is combined again', async () => {
    const before = (await colInfo()).features.find((x) => x.id === 'rocketpad').builtAt;
    expect((await call('PATCH', '/api/collections/team', { name: 'Team' })).status).toBe(200);
    await featureDone('rocketpad', before);
  });

  it('builds features again after a restart when they were made by an older engine', async () => {
    const file = join(root, 'team', '_features', 'rocketpad', 'feature.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), engine: '0.0.1' }));
    await srv.close();
    srv = await startServer({ port: 0, library: root, quiet: true, staticDir: web });
    await until(async () => { const f = (await colInfo()).features.find((x) => x.id === 'rocketpad'); return f.status === 'small' && f.engine !== '0.0.1'; }, 'the engine rebuild');
  });
});
