// Periods of a collection (a quarter, or any dates): a movie and a report,
// kept in the library folder and downloadable as one .html file.
// Generated repos with made-up people and messages only.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { makeRepo, tempDir, removeDir } from '@commit-wars/git-source/test-repo';

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
const periodDone = (id) => until(async () => { const p = (await colInfo()).periods.find((x) => x.id === id); return p && ['ready', 'small', 'error'].includes(p.status) ? p : null; }, `period ${id}`);

beforeAll(async () => {
  root = tempDir('cw-per-'); web = tempDir('cw-web-'); dirs.push(root, web);
  // a stand-in for the built web app
  mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>Commit Wars</title><script type="module" crossorigin src="./assets/app.js"></script><link rel="stylesheet" crossorigin href="./assets/app.css"><main></main>');
  writeFileSync(join(web, 'assets', 'app.js'), 'document.title = "app";');
  writeFileSync(join(web, 'assets', 'app.css'), 'main{color:red}');
  srv = await startServer({ port: 0, library: root, quiet: true, staticDir: web });
  const a = makeRepo({ n: 20, start: '2024-03-20' }); // Mar 20 – Apr 8
  const b = makeRepo({ n: 15, start: '2024-04-01' }); // Apr 1 – Apr 15
  dirs.push(a, b);
  await call('POST', '/api/collections', { name: 'Team' });
  await call('POST', '/api/collections/team/stories', { url: a, name: 'Alpha' });
  await call('POST', '/api/collections/team/stories', { url: b, name: 'Beta' });
  await until(async () => { const c = await colInfo(); return c.episode && c.episode.status === 'ready' && c.episode.repos === 2 ? c : null; }, 'the collection movie');
});
afterAll(async () => { await srv.close(); dirs.forEach(removeDir); });

describe('periods of a collection', () => {
  it('lists the quarters that have commits once the collection movie is built', async () => {
    const c = await colInfo();
    expect(c.episode.quarters.map((q) => [q.label, q.commits])).toEqual([['Q2 2024', 23], ['Q1 2024', 12]]);
    expect(c.periods).toEqual([]);
  });

  it('builds a quarter\'s movie and report and keeps them in the collection folder', async () => {
    const r = await call('POST', '/api/collections/team/periods', { from: '2024-04-01', to: '2024-06-30' });
    expect(r.status).toBe(202);
    expect(r.json.period).toMatchObject({ id: '2024-04-01_2024-06-30', label: 'Q2 2024' });
    const p = await periodDone('2024-04-01_2024-06-30');
    expect(p).toMatchObject({ status: 'ready', commits: 23, label: 'Q2 2024', hasEpisode: true, hasReport: true });
    const dir = join(root, 'team', '_periods', '2024-04-01_2024-06-30');
    for (const f of ['period.json', 'episode.json', 'report.json']) expect(existsSync(join(dir, f))).toBe(true);
    const ep = (await call('GET', '/api/collections/team/periods/2024-04-01_2024-06-30/episode')).json;
    expect(ep.timeline.start >= '2024-04-01').toBe(true);
    expect(ep.timeline.repos.map((x) => x.name)).toEqual(['Alpha', 'Beta']);
    const rep = (await call('GET', '/api/collections/team/periods/2024-04-01_2024-06-30/report')).json;
    expect(rep).toMatchObject({ collection: 'Team', label: 'Q2 2024', totals: { commits: 23, stories: 2 } });
    expect(rep.developers.length).toBeGreaterThan(0);
    // the period folder is not a story
    expect((await colInfo()).stories.map((s) => s.slug).sort()).toEqual(['alpha', 'beta']);
  });

  it('makes a report, without a movie, for a period too short to play', async () => {
    await call('POST', '/api/collections/team/periods', { from: '2024-03-20', to: '2024-03-22' });
    const p = await periodDone('2024-03-20_2024-03-22');
    expect(p).toMatchObject({ status: 'small', commits: 3, hasEpisode: false, hasReport: true });
    const e = await call('GET', '/api/collections/team/periods/2024-03-20_2024-03-22/episode');
    expect(e.status).toBe(404);
    expect(e.json.error).toMatch(/too few commits for a movie/);
    expect((await call('GET', '/api/collections/team/periods/2024-03-20_2024-03-22/report')).json.totals.commits).toBe(3);
  });

  it('says why a period has nothing in it', async () => {
    await call('POST', '/api/collections/team/periods', { from: '2023-01-01', to: '2023-03-31' });
    const p = await periodDone('2023-01-01_2023-03-31');
    expect(p.status).toBe('error');
    expect(p.error).toMatch(/None of this collection's stories has commits from Q1 2023/);
  });

  it('refuses dates that aren\'t a period', async () => {
    let r = await call('POST', '/api/collections/team/periods', { from: '2024-06-30', to: '2024-04-01' });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/before the end date/);
    r = await call('POST', '/api/collections/team/periods', { from: 'last week', to: '2024-04-01' });
    expect(r.status).toBe(400);
    expect((await call('GET', '/api/collections/team/periods/..%2F..%2Fx/report')).status).toBe(404);
  });

  it('downloads a period as one .html file with its movie and report inside', async () => {
    const r = await call('GET', '/api/collections/team/periods/2024-04-01_2024-06-30/share');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="Team-Q2-2024.commit-wars.html"');
    expect(r.text).toContain('<style>main{color:red}</style>');
    expect(r.text).toContain('<script type="module">document.title = "app";</script>');
    expect(r.text).not.toContain('./assets/');
    const data = JSON.parse(r.text.match(/window\.__CW_SHARE__=(.*?);<\/script>/)[1]);
    expect(data.report.label).toBe('Q2 2024');
    expect(data.episode.summary.commits).toBe(23);
    expect(r.text).toContain('<title>Team · Q2 2024 · Commit Wars</title>');
  });

  it('builds a period again, and deletes it', async () => {
    const before = (await colInfo()).periods.find((x) => x.id === '2024-04-01_2024-06-30').builtAt;
    expect((await call('POST', '/api/collections/team/periods/2024-04-01_2024-06-30/rebuild', {})).status).toBe(202);
    await until(async () => { const p = (await colInfo()).periods.find((x) => x.id === '2024-04-01_2024-06-30'); return p.status === 'ready' && p.builtAt !== before; }, 'the rebuild');
    expect((await call('DELETE', '/api/collections/team/periods/2024-03-20_2024-03-22')).status).toBe(200);
    expect(existsSync(join(root, 'team', '_periods', '2024-03-20_2024-03-22'))).toBe(false);
    expect((await colInfo()).periods.map((p) => p.id)).not.toContain('2024-03-20_2024-03-22');
  });

  it('builds periods again after a restart when they were made by an older engine', async () => {
    const file = join(root, 'team', '_periods', '2024-04-01_2024-06-30', 'period.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), engine: '0.0.1' }));
    await srv.close();
    srv = await startServer({ port: 0, library: root, quiet: true, staticDir: web });
    await until(async () => { const p = (await colInfo()).periods.find((x) => x.id === '2024-04-01_2024-06-30'); return p.status === 'ready' && p.engine !== '0.0.1'; }, 'the engine rebuild');
  });
});
