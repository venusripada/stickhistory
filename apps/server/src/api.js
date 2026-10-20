// HTTP API for the library. JSON in and out, errors as { error } in plain
// sentences. Writes must be JSON (so browsers preflight them, and we never
// answer preflights) and must come from a page on this machine. In LAN mode,
// other machines can read (watch) but every change still has to come from
// this machine, judged by the connection's own address.

import { readFileSync, existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { checkGitUrl, repoMeta, GitSourceError } from '@commit-wars/git-source';
import { LibraryError } from './library.js';
import { GitHubListError } from './github.js';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const MAX_BODY = 64 * 1024;
const MAX_BATCH_BODY = 1024 * 1024; // adding a whole organization's repos at once
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLocalClient = (req) => LOOPBACK.has(req.socket.remoteAddress);
/** LAN mode answers IP addresses and this machine's own name, never other names (that would let any website read the library). */
function lanHostOk(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  const me = hostname().toLowerCase();
  return LOCAL.test(host || '') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:]+\]$/.test(h) || h === me || h === `${me}.local` || h === `${me}.lan`;
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(text);
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const parts = [];
    // past the limit, keep reading but discard, so the client gets a 413 answer instead of a dropped connection
    req.on('data', (d) => {
      size += d.length;
      if (tooBig) return;
      if (size > max) { tooBig = true; parts.length = 0; reject(new HttpError(413, `That request is too large (over ${Math.round(max / 1024)} KB). Add fewer repositories at a time.`)); }
      else parts.push(d);
    });
    req.on('end', () => {
      if (tooBig) return;
      const text = Buffer.concat(parts).toString('utf8');
      if (!text) { resolve({}); return; }
      try { const v = JSON.parse(text); resolve(v && typeof v === 'object' ? v : {}); } catch { reject(new HttpError(400, 'The request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ library: any, jobs: any, events: { add: (res: any) => void }, lan?: boolean, github?: { listRepos: (owner: string) => Promise<any[]> } }} o
 * @returns {(req: any, res: any) => Promise<boolean>}  true when the request was an API request
 */
export function createApi({ library, jobs, events, lan = false, github = null }) {
  /** Same repository whatever form its link takes (ssh, https, with or without .git). */
  const repoKey = (url) => String(url ? (repoMeta(url).webUrl || url) : '').toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
  const keysIn = (c) => new Set(library.collection(c).stories.flatMap((s) => [repoKey(s.webUrl), repoKey(s.url)]).filter(Boolean));
  const rebuildCollection = (c) => { const cj = library.readCollectionJson(c); if (cj && cj.id) jobs.enqueueCollection(cj.id); };

  /** Merge two developers ("the same person") or separate one again; saved in collection.json, applied by a rebuild. */
  function peopleAction(c, body) {
    const cj = library.readCollectionJson(c);
    if (!cj) throw new HttpError(404, 'That collection doesn\'t exist.');
    const file = join(library.collectionDir(c), 'collection-episode.json');
    if (!existsSync(file)) throw new HttpError(409, 'This collection\'s movie hasn\'t been built yet. Wait for it to finish, then try again.');
    const people = JSON.parse(readFileSync(file, 'utf8')).timeline.people;
    const find = (name) => { const p = people.find((x) => x.name === name); if (!p) throw new HttpError(400, `There's no developer named "${name}" in this collection. Reload the list and try again.`); return p; };
    const settings = { merge: [...((cj.people && cj.people.merge) || [])], separate: [...((cj.people && cj.people.separate) || [])] };
    if (body.action === 'merge') {
      if (!Array.isArray(body.names) || body.names.length < 2) throw new HttpError(400, 'Pick two developers to merge.');
      const ps = body.names.map(String).map(find);
      const names = ps.map((p) => p.name);
      const ids = [...new Set(ps.flatMap((p) => [...(p.names || []), ...(p.emails || [])]))];
      const old = settings.merge.filter((m) => names.includes(m.name));
      settings.merge = [...settings.merge.filter((m) => !names.includes(m.name)), { name: names[0], ids: [...new Set([...old.flatMap((m) => m.ids), ...ids])] }];
      const lower = new Set(ids.map((x) => String(x).toLowerCase()));
      settings.separate = settings.separate.filter((n) => !lower.has(String(n).toLowerCase()));
    } else if (body.action === 'separate') {
      const p = find(String(body.name || ''));
      if (settings.merge.some((m) => m.name === p.name)) settings.merge = settings.merge.filter((m) => m.name !== p.name);
      else settings.separate = [...new Set([...settings.separate, ...(p.names || [])])];
    } else throw new HttpError(400, 'Choose "merge" or "separate".');
    library.writeCollectionJson(c, { ...cj, people: settings });
    events.changed();
    return [202, { people: settings, job: jobs.enqueueCollection(cj.id) }];
  }

  const routes = [
    ['GET', /^\/api\/library$/, (m, body, q, req) => ({ collections: library.list(), canManage: isLocalClient(req) })],
    ['GET', /^\/api\/jobs$/, () => ({ jobs: jobs.list() })],
    ['POST', /^\/api\/collections$/, (m, body) => { events.changed(); return [201, { collection: library.createCollection(body) }]; }],
    ['PATCH', /^\/api\/collections\/([^/]+)$/, ([c], body) => { const collection = library.updateCollection(c, body); events.changed(); if (body.name != null) rebuildCollection(collection.slug); return { collection }; }],
    ['POST', /^\/api\/collections\/([^/]+)\/people$/, ([c], body) => peopleAction(c, body)],
    ['GET', /^\/api\/orgs\/([^/]+)\/repos$/, async ([owner], body, q, req) => {
      // the list can include private repos and uses this machine's gh login: this machine only
      if (!isLocalClient(req)) throw new HttpError(403, 'Organizations can be listed only on the machine running the library.');
      if (!github) throw new HttpError(503, 'Listing organizations isn\'t available on this server.');
      const repos = await github.listRepos(owner);
      const have = q.get('collection') ? keysIn(q.get('collection')) : new Set();
      return { owner, repos: repos.map((r) => ({ ...r, inCollection: have.has(repoKey(r.webUrl)) || have.has(repoKey(r.url)) })) };
    }],
    ['POST', /^\/api\/collections\/([^/]+)\/stories\/batch$/, ([c], body) => {
      library.collection(c);
      const list = Array.isArray(body.repos) ? body.repos : [];
      if (!list.length) throw new HttpError(400, 'Tick at least one repository to add.');
      if (list.length > 500) throw new HttpError(400, 'Add at most 500 repositories at a time.');
      const checked = list.map((r) => ({ r, url: checkGitUrl(r.url).url }));
      const have = keysIn(c);
      const added = [], skipped = [];
      for (const { r, url } of checked) {
        const webUrl = r.webUrl || repoMeta(url).webUrl;
        if (have.has(repoKey(webUrl)) || have.has(repoKey(url))) { skipped.push(r.name || url); continue; }
        const story = library.createStory(c, { name: r.name || repoMeta(url).name, url, webUrl, branch: null });
        jobs.enqueue('build', story.id);
        have.add(repoKey(webUrl)); have.add(repoKey(url));
        added.push(story.slug);
      }
      events.changed();
      return [202, { added, skipped }];
    }],
    ['DELETE', /^\/api\/collections\/([^/]+)$/, ([c], body, q) => { library.deleteCollection(c, { confirm: q.get('confirm') }); events.changed(); return { ok: true }; }],
    ['POST', /^\/api\/collections\/([^/]+)\/update$/, ([c]) => {
      const col = library.collection(c);
      return [202, { jobs: col.stories.filter((s) => s.setUp).map((s) => jobs.enqueue('update', s.id)) }];
    }],
    ['POST', /^\/api\/collections\/([^/]+)\/stories$/, ([c], body) => {
      library.collection(c);
      const { url } = checkGitUrl(body.url);
      const meta = repoMeta(url);
      const story = library.createStory(c, { name: body.name || meta.name, url, webUrl: meta.webUrl, branch: body.branch || null });
      events.changed();
      return [202, { story, job: jobs.enqueue('build', story.id) }];
    }],
    ['PATCH', /^\/api\/collections\/([^/]+)\/stories\/([^/]+)$/, ([c, s], body) => {
      let at = { c, s };
      if (body.name != null || body.collection != null) {
        at = library.relocateStory(c, s, { name: body.name, collection: body.collection });
        rebuildCollection(c);
        if (at.c !== c) rebuildCollection(at.c);
      }
      const st = library.readStoryJson(at.c, at.s);
      let job = null;
      if (st && (body.branch !== undefined || body.aliases !== undefined || body.titles !== undefined)) {
        if (body.branch !== undefined) st.branch = body.branch ? String(body.branch).trim() : null;
        if (body.aliases !== undefined) {
          if (!body.aliases || typeof body.aliases !== 'object' || Array.isArray(body.aliases)) throw new HttpError(400, 'Aliases must be an object like {"Ada": ["Ada L", "ada@example.com"]}.');
          st.aliases = body.aliases;
        }
        if (body.titles !== undefined) st.titles = Array.isArray(body.titles) ? body.titles.map(String) : [];
        library.writeStoryJson(at.c, at.s, st);
        job = jobs.enqueue('reread', st.id);
      }
      events.changed();
      return { story: library.story(at.c, at.s), job };
    }],
    ['DELETE', /^\/api\/collections\/([^/]+)\/stories\/([^/]+)$/, ([c, s], body, q) => { library.deleteStory(c, s, { confirm: q.get('confirm') }); events.changed(); rebuildCollection(c); return { ok: true }; }],
    ['POST', /^\/api\/collections\/([^/]+)\/stories\/([^/]+)\/update$/, ([c, s]) => {
      const st = library.story(c, s);
      if (!st.setUp) throw new HttpError(409, 'This folder was added by hand and has no story.json. Add the story again from the library.');
      return [202, { job: jobs.enqueue('update', st.id) }];
    }],
  ];

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (!(lan ? lanHostOk(req.headers.host) : LOCAL.test(req.headers.host || ''))) throw new HttpError(403, 'This server only answers requests made on this machine or by its address on the local network.');
      if (req.method !== 'GET') {
        if (!isLocalClient(req)) throw new HttpError(403, 'Stories can be added and changed only on the machine running the library. From other machines the library is watch-only.');
        const origin = req.headers.origin;
        if (origin) { let h = ''; try { h = new URL(origin).host; } catch { /* bad origin */ } if (!LOCAL.test(h)) throw new HttpError(403, 'This server only accepts changes from pages on this machine.'); }
      }
      const path = url.pathname.split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
      const route = url.pathname;

      if (req.method === 'GET' && route === '/api/events') { events.add(res); return true; }
      const cep = route.match(/^\/api\/collections\/([^/]+)\/episode$/);
      if (req.method === 'GET' && cep) {
        const c = path[3];
        const cj = library.readCollectionJson(c);
        const file = join(library.collectionDir(c), 'collection-episode.json');
        if (!existsSync(file)) {
          const built = library.collection(c).stories.some((s) => s.hasEpisode);
          if (built && cj && cj.id) jobs.enqueueCollection(cj.id);
          throw new HttpError(404, built ? 'This collection\'s movie is being put together. It will start as soon as it is ready.' : 'This collection has no built stories yet. Add a story and wait for it to build.');
        }
        const etag = `"${(cj && cj.episode && cj.episode.builtAt) || 'built'}"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache' }); res.end(); return true; }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag, 'cache-control': 'no-cache' });
        res.end(readFileSync(file));
        return true;
      }
      const ep = route.match(/^\/api\/collections\/([^/]+)\/stories\/([^/]+)\/episode$/);
      if (req.method === 'GET' && ep) {
        const [c, s] = [path[3], path[5]];
        const dir = library.storyDir(c, s);
        const st = library.readStoryJson(c, s);
        const file = join(dir, 'episode.json');
        if (!existsSync(file)) throw new HttpError(404, 'This story hasn\'t been built yet. Wait for its build to finish, or press Update.');
        const etag = `"${(st && st.builtAt) || 'built'}"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': 'no-cache' }); res.end(); return true; }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag, 'cache-control': 'no-cache' });
        res.end(readFileSync(file));
        return true;
      }

      // POST can be sent cross-site without a preflight unless it is JSON; DELETE and PATCH are always preflighted.
      if ((req.method === 'POST' || req.method === 'PATCH') && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send changes as JSON (Content-Type: application/json).');
      for (const [method, re, fn] of routes) {
        if (method !== req.method || !re.test(route)) continue;
        const params = re.exec(route).slice(1).map((p) => decodeURIComponent(p));
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req, /\/stories\/batch$/.test(route) ? MAX_BATCH_BODY : MAX_BODY);
        const out = await fn(params, body, url.searchParams, req);
        if (Array.isArray(out)) send(res, out[0], out[1]); else send(res, 200, out);
        return true;
      }
      throw new HttpError(404, `There's no ${req.method} ${route} in this API.`);
    } catch (e) {
      const status = e instanceof HttpError || e instanceof LibraryError || e instanceof GitHubListError ? e.status : e instanceof GitSourceError ? 400 : 500;
      send(res, status, { error: e && e.message ? e.message : 'Something went wrong on the server.' }, status === 413 ? { connection: 'close' } : {});
      if (status === 500) console.error(e);
      return true;
    }
  };
}
