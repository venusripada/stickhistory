// The server keeps answering while a big collection is being combined.
// Made-up histories written straight to a temporary library.

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { tempDir, removeDir } from '@commit-wars/git-source/test-repo';

function bigHistory(name, n) {
  const commits = [];
  for (let i = 0; i < n; i++) {
    const p = i % 40;
    commits.push({ sha: `${name}${String(i).padStart(8, '0')}`.padEnd(40, '0'), date: new Date(Date.UTC(2020, 0, 1) + i * 3600000).toISOString().slice(0, 10),
      message: i % 3 ? `fix(core): bug ${i}` : `feat: thing ${i}`, author: { name: `Dev ${p}`, email: `dev${p}@example.test`, login: null },
      files: 1 + (i % 9), paths: [`src/m${i % 7}.js`], pr: null, issues: [], tags: i % 5000 === 0 ? [`v${i / 5000}.0.0`] : [], parents: 1 });
  }
  return { historyVersion: 1, repo: { owner: null, name, url: null, defaultBranch: 'main' }, source: 'git-log', truncated: false, commitLimit: null, totalCommits: n, fetchedAt: '2026-01-01T00:00:00Z', commits };
}

describe('a big collection build', () => {
  const root = tempDir('cw-big-');
  afterAll(() => removeDir(root));
  it('does not stop the server from answering', async () => {
    mkdirSync(join(root, 'big'), { recursive: true });
    writeFileSync(join(root, 'big', 'collection.json'), JSON.stringify({ id: 'big-id', name: 'Big', order: [], people: { merge: [], separate: [] } }));
    for (const s of ['one', 'two', 'three']) {
      mkdirSync(join(root, 'big', s));
      writeFileSync(join(root, 'big', s, 'story.json'), JSON.stringify({ id: `id-${s}`, name: s, url: `file:///nowhere/${s}`, status: 'ready', commits: 40000 }));
      writeFileSync(join(root, 'big', s, 'history.json'), JSON.stringify(bigHistory(s, 40000)));
      writeFileSync(join(root, 'big', s, 'episode.json'), '{}');
    }
    const srv = await startServer({ port: 0, library: root, quiet: true }); // starts combining on start
    try {
      let worst = 0, ready = false;
      const t0 = Date.now();
      while (!ready && Date.now() - t0 < 120000) {
        const t = Date.now();
        const lib = await (await fetch(srv.url + '/api/library')).json();
        worst = Math.max(worst, Date.now() - t);
        ready = lib.collections[0].episode?.status === 'ready';
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(ready).toBe(true);
      expect(worst).toBeLessThan(1500);
    } finally { await srv.close(); }
  }, 150000);
  it('builds a period right away, without waiting for a big combine to finish', async () => {
    const root2 = tempDir('cw-lanes-');
    try {
      const write = (c, id, stories, n) => {
        mkdirSync(join(root2, c), { recursive: true });
        writeFileSync(join(root2, c, 'collection.json'), JSON.stringify({ id, name: c, order: [], people: { merge: [], separate: [] } }));
        for (const s of stories) {
          mkdirSync(join(root2, c, s));
          writeFileSync(join(root2, c, s, 'story.json'), JSON.stringify({ id: `${id}-${s}`, name: s, url: `file:///nowhere/${s}`, status: 'ready', commits: n }));
          writeFileSync(join(root2, c, s, 'history.json'), JSON.stringify(bigHistory(s, n)));
          writeFileSync(join(root2, c, s, 'episode.json'), '{}');
        }
      };
      write('big', 'big-id', ['one', 'two', 'three'], 40000);
      write('team', 'team-id', ['alpha', 'beta'], 400); // Jan 1 – Jan 17, 2020
      const srv = await startServer({ port: 0, library: root2, quiet: true }); // starts combining both on start
      try {
        const r = await fetch(srv.url + '/api/collections/team/periods', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: '2020-01-01', to: '2020-01-31' }) });
        expect(r.status).toBe(202);
        let lib;
        const t0 = Date.now();
        for (;;) {
          lib = await (await fetch(srv.url + '/api/library')).json();
          const p = lib.collections.find((c) => c.slug === 'team').periods[0];
          if (p && ['ready', 'error'].includes(p.status)) break;
          if (Date.now() - t0 > 60000) throw new Error('the period never finished');
          await new Promise((res) => setTimeout(res, 50));
        }
        expect(lib.collections.find((c) => c.slug === 'team').periods[0].status).toBe('ready');
        expect(lib.collections.find((c) => c.slug === 'big').episode?.status).toBe('building');
      } finally { await srv.close(); }
    } finally { removeDir(root2); }
  }, 150000);
});
