// End-to-end check of the built web app with GitHub mocked out.
// Run: npm run build && npm run e2e
// Serves apps/web/dist, drives Chromium with Playwright, and answers
// api.github.com requests from e2e/fixtures/opencode-graphql.json
// (real opencode commits in GraphQL shape). e2e/fixtures/ky-git-log.txt is
// real sindresorhus/ky `git log` output in GIT_LOG_COMMAND's format.

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildEpisode, parseGitLog, activeAt, isoOfDay, commitRange, TL } from '../packages/story-engine/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', 'apps', 'web', 'dist');
const OUT = join(here, 'output');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) { console.error('Build the app first: npm run build'); process.exit(1); }
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'opencode-graphql.json'), 'utf8'));
const sample = JSON.parse(readFileSync(join(DIST, 'samples', 'opencode.json'), 'utf8'));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(DIST, p === '/' ? 'index.html' : p);
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let apiCalls = 0;
async function mockGitHub(page, { rateLimitRest = false } = {}) {
  await page.route('https://api.github.com/**', async (route) => {
    apiCalls++;
    const req = route.request();
    const url = new URL(req.url());
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, Link, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset', ...headers }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST' } });
    if (url.pathname === '/graphql') {
      const { query, variables } = JSON.parse(req.postData());
      if (query.includes('defaultBranchRef')) return json({ data: { repository: { nameWithOwner: 'anomalyco/opencode', url: 'https://github.com/anomalyco/opencode', isPrivate: false, defaultBranchRef: { name: 'dev' } }, rateLimit: { remaining: 4999 } } });
      if (query.includes('history(')) {
        const start = variables.after ? Number(variables.after) : 0;
        const nodes = fixture.nodes.slice(start, start + variables.first);
        const end = start + nodes.length;
        await new Promise((r) => setTimeout(r, 60));
        return json({ data: { repository: { ref: { target: { history: { totalCount: fixture.nodes.length, pageInfo: { hasNextPage: end < fixture.nodes.length, endCursor: String(end) }, nodes } } } } }, rateLimit: { cost: 1, remaining: 4990 } });
      }
      if (query.includes('refs(')) return json({ data: { repository: { refs: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } });
    }
    if (rateLimitRest) return json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1500) });
    return json({ message: 'Not Found' }, 404);
  });
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const canvasInk = (page) => page.evaluate(() => {
  const c = document.querySelector('#stage'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 120) n++; return n;
});

// Pause the movie, then put the playhead on a whole day through the timeline control.
async function pauseAndScrub(page, day) {
  if ((await page.textContent('#playLabel')) === 'Pause') await page.click('#bPlay');
  await page.evaluate((d) => { const s = document.querySelector('#scrub'); s.value = String(d); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }, day);
  await page.waitForTimeout(250);
}
const readEpisodeFromIDB = (page, key) => page.evaluate((k) => new Promise((res) => {
  const r = indexedDB.open('commit-wars', 1);
  r.onsuccess = () => { const g = r.result.transaction('episodes').objectStore('episodes').get(k); g.onsuccess = () => res(g.result ? g.result.episode : null); g.onerror = () => res(null); };
  r.onerror = () => res(null);
}), key);

const browser = await chromium.launch();
try {
  // 1. Home page plays the bundled sample as a movie, and the overlays match the engine.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await mockGitHub(page);
    await page.goto(BASE);
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    const d0 = await page.textContent('#ovDate');
    await page.waitForTimeout(3500);
    const d1 = await page.textContent('#ovDate');
    check('sample loads and the movie plays', (await page.textContent('#repoTitle')).includes('opencode') && (await canvasInk(page)) > 50 && d0 !== d1, `${d0} → ${d1}`);
    check('sample builds chapter list and heroes to follow', (await page.locator('.chap').count()) >= 3 && (await page.locator('.hero-card[data-name]').count()) >= 4);
    await page.locator('#movie').screenshot({ path: join(OUT, '1-sample.png') });

    const tl = sample.timeline, day = 300;
    await pauseAndScrub(page, day);
    const shown = await page.textContent('#ovDate');
    check('scrubbing the timeline moves the date', shown === fmtDate(isoOfDay(tl, day)), shown);
    const names = await page.$$eval('#peopleList button', (bs) => bs.map((b) => b.textContent));
    const want = activeAt(tl, day, { window: 14, limit: 12 }).map((a) => a.name);
    check('people panel matches who was active', names.join('|') === want.join('|'), names.slice(0, 4).join(', '));
    const [from, to] = commitRange(tl, day, day + 1);
    const todayRows = await page.locator('#feedList li.today').count();
    const firstSha = await page.$eval('#feedList li', (li) => li.textContent);
    check('feed lists the commits of the day, newest first', todayRows === Math.min(60, to - from) && firstSha.includes(tl.commits[to - 1][TL.s].slice(0, 30)), `${todayRows} today`);
    await page.locator('#movie').screenshot({ path: join(OUT, '2-scrubbed.png') });

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    check('arrow key moves a week', (await page.textContent('#ovDate')) === fmtDate(isoOfDay(tl, day + 7)), await page.textContent('#ovDate'));

    const hero = sample.roster[1].name;
    await page.click(`.hero-card[data-name="${hero}"]`);
    await page.waitForTimeout(300);
    const who = await page.$$eval('#feedList li .who', (els) => [...new Set(els.map((e) => e.firstChild.textContent))]);
    check('following a hero filters the feed and people to them', who.length === 1 && who[0] === hero && (await page.textContent('#modeLabel')).includes(hero), who.join(', '));
    await page.click('#bAll');
    await page.waitForTimeout(200);
    check('show everyone ends following', !(await page.textContent('#modeLabel')).includes('Following'));

    await page.click('#bFull');
    await page.waitForTimeout(400);
    const full = await page.evaluate(() => document.fullscreenElement && document.fullscreenElement.id);
    check('full screen button fills the screen with the movie', full === 'movie', String(full));
    if (full) { await page.locator('#movie').screenshot({ path: join(OUT, '3-fullscreen.png') }); await page.evaluate(() => document.exitFullscreen()); }

    await page.click('#bFeed');
    check('feed overlay toggles', await page.locator('#ovFeed').isHidden());
    await page.click('#bFeed');
    check('no page errors on the sample', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 2. Paste a link with a token: fetch, build, play, cache, reload from cache.
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await mockGitHub(page);
    await page.goto(BASE);
    await page.click('#tokenBox summary');
    await page.fill('#token', 'github_pat_test');
    await page.fill('#repoUrl', 'https://github.com/anomalyco/opencode');
    apiCalls = 0;
    await page.click('#bBuild');
    await page.waitForSelector('#progressCard:not([hidden])', { timeout: 5000 });
    await page.screenshot({ path: join(OUT, '4-progress.png'), clip: { x: 0, y: 0, width: 1200, height: 700 } });
    await page.waitForSelector('#progressCard[hidden]', { state: 'attached', timeout: 30000 });
    const hash = await page.evaluate(() => location.hash);
    check('link builds an episode and routes to it', hash === '#/r/anomalyco/opencode', hash);
    check('GitHub API was called', apiCalls >= 13, `${apiCalls} calls`);
    const err = await page.locator('#errorBox').isVisible();
    check('no error shown after building', !err, err ? await page.textContent('#errorBox') : '');
    const ep = await readEpisodeFromIDB(page, 'anomalyco/opencode');
    check('episode cached with linked issues', !!ep && ep.summary.commits === 1200 && ep.summary.issuesLinked > 0, ep ? `${ep.summary.commits} commits, ${ep.summary.issuesLinked} issues` : 'not cached');
    if (ep) {
      const i = ep.timeline.commits.findIndex((c) => c[TL.issues] && c[TL.kind] === 'fix');
      const c = ep.timeline.commits[i];
      await pauseAndScrub(page, c[TL.day]);
      const href = await page.getAttribute(`#feedList a[href$="/issues/${c[TL.issues][0]}"]`, 'href').catch(() => null);
      check('feed links fixes to the issue they closed', href === `https://github.com/anomalyco/opencode/issues/${c[TL.issues][0]}`, href || 'no link');
      await page.locator('#movie').screenshot({ path: join(OUT, '5-built.png') });
    }
    apiCalls = 0;
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    await page.waitForTimeout(500);
    check('reload plays from cache without calling GitHub', apiCalls === 0 && (await page.isVisible('#cacheNote')), `${apiCalls} calls; note: ${await page.textContent('#cacheNote')}`);
    check('no page errors while building and playing', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: join(OUT, '6-full-desktop.png'), fullPage: true });
    await ctx.close();
  }
  // 3. Without a token and rate limited: readable error, token box opens.
  {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    await mockGitHub(page, { rateLimitRest: true });
    await page.goto(BASE);
    await page.fill('#repoUrl', 'expressjs/express');
    await page.click('#bBuild');
    await page.waitForSelector('#errorBox:not([hidden])', { timeout: 10000 });
    const msg = await page.textContent('#errorBox');
    check('rate limit error explains reset time and token', /resets in about 25 minutes\. Add a token/.test(msg), msg);
    check('token box opens on rate limit', await page.evaluate(() => document.querySelector('#tokenBox').open));
    await ctx.close();
  }
  // 4. Bad input.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.fill('#repoUrl', 'https://gitlab.com/a/b');
    await page.click('#bBuild');
    check('non-GitHub links are explained', /Only github.com/.test(await page.textContent('#errorBox')));
    await ctx.close();
  }
  // 5. Embed mode and phone width.
  {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 400 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '?embed=1#/sample/opencode');
    await page.waitForTimeout(2000);
    const visible = await page.evaluate(() => ({ builder: getComputedStyle(document.querySelector('.builder')).display, chapters: getComputedStyle(document.querySelector('#chapters').closest('section')).display }));
    const ink = await canvasInk(page);
    check('embed shows only the movie', visible.builder === 'none' && visible.chapters === 'none' && (await page.isVisible('#ovDate')) && ink > 20, `ink ${ink}`);
    await page.screenshot({ path: join(OUT, '7-embed.png') });
    await ctx.close();
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p2 = await phone.newPage();
    await p2.goto(BASE);
    await p2.waitForTimeout(2500);
    const sw = await p2.evaluate(() => document.documentElement.scrollWidth);
    check('no sideways scroll at phone width', sw <= 390, `scrollWidth ${sw}`);
    check('overlays start closed on a phone', await p2.locator('#ovFeed').isHidden() && await p2.locator('#ovPeople').isHidden());
    await p2.screenshot({ path: join(OUT, '8-phone.png'), fullPage: true });
    await p2.click('#bFeed');
    await p2.locator('#movie').screenshot({ path: join(OUT, '9-phone-feed.png') });
    await phone.close();
  }
  // 6. Dark theme renders.
  {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(BASE + '#/sample/opencode');
    await page.waitForTimeout(6000);
    await page.locator('#movie').screenshot({ path: join(OUT, '10-dark.png') });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('dark theme applies', bg === 'rgb(18, 24, 32)', bg);
    await ctx.close();
  }
  // 7. A local git log file with commit bodies: "Fixes #N" becomes an issue enemy.
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE);
    check('git log command includes commit bodies', (await page.textContent('#cmdText')).includes('%b%x1e'));
    const logText = readFileSync(join(here, 'fixtures', 'ky-git-log.txt'), 'utf8');
    const ep = buildEpisode(parseGitLog(logText, { repoName: 'ky' }));
    check('ky log links issues from commit bodies', ep.summary.issuesLinked > 0, `${ep.summary.issuesLinked} issues`);
    await page.setInputFiles('#logFile', { name: 'ky.txt', mimeType: 'text/plain', buffer: Buffer.from(logText) });
    await page.waitForFunction(() => document.querySelector('#repoTitle').textContent.includes('ky'), null, { timeout: 10000 });
    const i = ep.timeline.commits.findIndex((c) => c[TL.issues] && c[TL.kind] === 'fix');
    if (i >= 0) {
      const c = ep.timeline.commits[i];
      await pauseAndScrub(page, c[TL.day]);
      const feed = await page.textContent('#feedList');
      check('local issue links show in the feed without a title', feed.includes('#' + c[TL.issues][0]) && !/null|undefined/.test(feed.replace(/`[^`]*`/g, '')), `#${c[TL.issues][0]}`);
      await page.locator('#movie').screenshot({ path: join(OUT, '11-local-log.png') });
    }
    // An episode file from the old format is refused with a way forward.
    await page.setInputFiles('#episodeFile', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, summary: {}, chapters: [], roster: [] })) });
    await page.waitForSelector('#errorBox:not([hidden])', { timeout: 5000 });
    const oldMsg = await page.textContent('#errorBox');
    check('old episode files ask to be rebuilt', /older version.*Rebuild/.test(oldMsg), oldMsg);
    check('no page errors on a local log', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in e2e/output/.`);
process.exit(failed.length ? 1 : 0);
