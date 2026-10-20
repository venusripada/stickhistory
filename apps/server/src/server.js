#!/usr/bin/env node
// Commit Wars library server. Local only: it listens on 127.0.0.1.
//
//   node apps/server/src/server.js [--port 5174] [--library ./library] [--static apps/web/dist] [--lan]
//
// The library folder defaults to $COMMIT_WARS_LIBRARY or ./library. With
// --static it also serves the built web app, so one port runs everything.
// --lan listens on the local network too: other machines can watch, and
// only this machine can add, update or delete stories.

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, extname, normalize, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createLibrary } from './library.js';
import { createJobs } from './jobs.js';
import { createApi } from './api.js';
import { createGitHub } from './github.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/** Server-sent events to every open page. */
function createEvents() {
  const clients = new Set();
  const write = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const timer = setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n'); }, 20000);
  timer.unref();
  return {
    add(res) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      write(res, 'hello', {});
      clients.add(res);
      res.on('close', () => clients.delete(res));
    },
    send(type, data) { for (const res of clients) write(res, type, data); },
    changed() { for (const res of clients) write(res, 'library', {}); },
    close() { clearInterval(timer); for (const res of clients) res.end(); clients.clear(); },
  };
}

function serveStatic(dir, req, res) {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(dir, p === '/' ? 'index.html' : p));
  if (!file.startsWith(normalize(dir + sep)) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': p.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-cache' });
  res.end(readFileSync(file));
}

/**
 * @param {{ port?: number, library?: string, staticDir?: string|null, quiet?: boolean, lan?: boolean, github?: any }} [o]  `github` replaces the gh-based org lister (tests).
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer(o = {}) {
  const root = resolve(o.library || process.env.COMMIT_WARS_LIBRARY || 'library');
  const library = createLibrary(root);
  const events = createEvents();
  const jobs = createJobs({ library, emit: (type, data) => events.send(type, data) });
  // the shareable period file is made from the built web app, served here or not
  const webDist = o.staticDir || fileURLToPath(new URL('../../web/dist', import.meta.url));
  const api = createApi({ library, jobs, events, lan: !!o.lan, github: o.github || createGitHub(), staticDir: webDist });
  const server = createServer(async (req, res) => {
    if (await api(req, res)) return;
    if (o.staticDir) serveStatic(o.staticDir, req, res);
    else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('This is the Commit Wars library API. Open the web app instead.'); }
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(o.port ?? 5174, o.lan ? '0.0.0.0' : '127.0.0.1', r); });
  const port = server.address().port;
  jobs.recover();
  if (!o.quiet) {
    console.log(`Commit Wars library server on http://127.0.0.1:${port}${o.staticDir ? '' : '/api'}\nLibrary folder: ${root}`);
    if (o.lan) {
      const ips = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
      console.log(`Watch-only on the local network: ${ips.map((ip) => `http://${ip}:${port}`).join('  ') || '(no network address found)'}`);
    }
  }
  return {
    url: `http://127.0.0.1:${port}`, port,
    close: () => new Promise((r) => { events.close(); server.close(() => r()); server.closeAllConnections?.(); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  startServer({ port: opt('--port') ? Number(opt('--port')) : 5174, library: opt('--library'), staticDir: opt('--static') ? resolve(opt('--static')) : null, lan: args.includes('--lan') })
    .catch((e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${opt('--port') || 5174} is already in use. Stop the other server or pass --port.` : e.message);
      process.exit(1);
    });
}
