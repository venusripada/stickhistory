// End-to-end check of the built web app with the real library server.
// Run: npm run build && npm run e2e
// Starts apps/server against a temporary library folder (serving apps/web/dist
// on the same port) and drives Chromium with Playwright. Stories are made from
// repos generated here with made-up people and messages; nothing reads the
// real library or the network. e2e/fixtures/ky-git-log.txt is real
// sindresorhus/ky `git log` output in GIT_LOG_COMMAND's format (public).

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildEpisode, parseGitLog, activeAt, isoOfDay, commitRange, TL } from '../packages/story-engine/src/index.js';
import { startServer } from '../apps/server/src/server.js';
import { makeRepo, addCommits, tempDir, removeDir } from '../packages/git-source/test/make-repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', 'apps', 'web', 'dist');
const OUT = join(here, 'output');
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) { console.error('Build the app first: npm run build'); process.exit(1); }
const sample = JSON.parse(readFileSync(join(DIST, 'samples', 'opencode.json'), 'utf8'));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => { const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; };

// The real server, with a throwaway library.
const libRoot = tempDir('cw-e2e-lib-');
const app = await startServer({ port: 0, library: libRoot, staticDir: DIST, quiet: true });
const BASE = app.url + '/';

// A plain static server: the same app with no library server behind it.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const offline = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(DIST, p === '/' ? 'index.html' : p);
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => offline.listen(0, '127.0.0.1', r));
const OFFLINE_BASE = `http://127.0.0.1:${offline.address().port}/`;
const repos = [];

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
const browser = await chromium.launch();
try {
  // 1. Home page plays the bundled sample as a movie, and the overlays match the engine.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '#/sample/opencode');
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
  // 2. The library: collections and stories managed from the page, built by the server.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const repo = makeRepo({ n: 40, tagAt: { 20: 'v1.0.0' } }); repos.push(repo);
    await page.goto(BASE);
    await page.waitForSelector('#libraryView:not([hidden])');
    check('home is the library', (await page.textContent('#collections')).includes('library is empty') && await page.locator('#stageWrap').isHidden());

    await page.fill('#colName', 'Side projects');
    await page.click('#colForm button');
    await page.waitForSelector('[data-collection="side-projects"]');
    check('a new collection is a folder', existsSync(join(libRoot, 'side-projects', 'collection.json')));

    await page.fill('#repoUrl', repo);
    await page.selectOption('#addCollection', 'side-projects');
    await page.fill('#addName', 'Demo');
    await page.click('#bAdd');
    await page.waitForSelector('[data-collection="side-projects"] .story-card a.btn.primary', { timeout: 30000 });
    const card = await page.textContent('[data-collection="side-projects"] .story-card');
    check('adding a link clones and builds a story', card.includes('Demo') && card.includes('40 commits'), card.replace(/\s+/g, ' ').slice(0, 90));
    check('the story folder holds the clone and the built story', ['story.json', 'history.json', 'episode.json', 'repo.git/HEAD'].every((f) => existsSync(join(libRoot, 'side-projects', 'demo', f))));
    await page.screenshot({ path: join(OUT, '4-library.png'), fullPage: true });

    await page.click('[data-collection="side-projects"] .story-card a.btn.primary');
    await page.waitForSelector('#stageWrap:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    check('a story plays from the library', (await page.textContent('#crumbCol')) === 'Side projects' && (await page.textContent('#crumbStory')) === 'Demo' && (await page.evaluate(() => location.hash)) === '#/s/side-projects/demo');
    await page.locator('#movie').screenshot({ path: join(OUT, '5-library-story.png') });
    for (let k = 0; k < 3; k++) await page.click('#bSpeed');
    const duel = await page.waitForFunction(() => /^Duel: .+ vs "/.test(document.querySelector('#caption').textContent), null, { timeout: 40000 }).then(() => true, () => false);
    const cap = await page.textContent('#caption');
    await page.locator('#movie').screenshot({ path: join(OUT, '5b-duel-label.png') });
    check('duels name the fix in words, not by commit hash', duel && !/\b[0-9a-f]{7}\b/.test(cap), cap);

    addCommits(repo, { n: 3, from: 40 });
    await page.click('#cacheNote button');
    await page.waitForFunction(() => /New commits are in/.test(document.querySelector('#storyNotice').textContent), null, { timeout: 30000 });
    await page.click('#storyNotice button');
    await page.waitForTimeout(500);
    const ep = await page.evaluate(() => fetch('/api/collections/side-projects/stories/demo/episode').then((r) => r.json()));
    await pauseAndScrub(page, ep.timeline.days - 1);
    const totals = await page.textContent('#ovTotals');
    check('Update fetches new commits and the story reloads with them', ep.summary.commits === 43 && totals.startsWith('43 commits'), totals);

    await page.click('#crumbHome');
    await page.waitForSelector('#libraryView:not([hidden]) .story-card');
    await page.click('.story-card button:has-text("Rename")');
    await page.fill('.story-card .inline input', 'Demo Renamed');
    await page.click('.story-card .inline button:has-text("Save")');
    await page.waitForSelector('.story-card h4:has-text("Demo Renamed")');
    check('renaming a story renames its folder', existsSync(join(libRoot, 'side-projects', 'demo-renamed', 'episode.json')) && !existsSync(join(libRoot, 'side-projects', 'demo')));

    await page.fill('#colName', 'Archive');
    await page.click('#colForm button');
    await page.waitForSelector('[data-collection="archive"]');
    await page.selectOption('[data-collection="side-projects"] .story-card select.move', 'archive');
    await page.waitForSelector('[data-collection="archive"] .story-card');
    check('moving a story moves its folder', existsSync(join(libRoot, 'archive', 'demo-renamed', 'repo.git')) && !existsSync(join(libRoot, 'side-projects', 'demo-renamed')));

    await page.click('[data-collection="archive"] .story-card button:has-text("Delete")');
    check('deleting asks first', (await page.textContent('[data-collection="archive"] .confirm')).includes('removed from the library folder'));
    await page.click('[data-collection="archive"] .confirm .danger');
    await page.waitForFunction(() => !document.querySelector('[data-collection="archive"] .story-card'));
    check('deleting removes the story folder', !existsSync(join(libRoot, 'archive', 'demo-renamed')));

    await page.fill('#repoUrl', '--upload-pack=touch /tmp/x');
    await page.click('#bAdd');
    await page.waitForSelector('#errorBox:not([hidden])');
    check('odd links are refused with a reason', /isn't a repository link/.test(await page.textContent('#errorBox')), await page.textContent('#errorBox'));
    check('no page errors in the library', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 3. Without the library server, the page says how to start it and still plays the sample.
  {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(OFFLINE_BASE);
    await page.waitForSelector('#offline:not([hidden])', { timeout: 10000 });
    check('a missing server is explained', /npm run dev/.test(await page.textContent('#offline')));
    await page.click('#offline [data-sample]');
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    check('the bundled sample still plays without the server', (await page.textContent('#crumbStory')) === 'opencode');
    await ctx.close();
  }
  // 5. Embed mode and phone width.
  {
    const ctx = await browser.newContext({ viewport: { width: 700, height: 400 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '?embed=1#/sample/opencode');
    await page.waitForTimeout(2000);
    const visible = await page.evaluate(() => ({ library: getComputedStyle(document.querySelector('.library')).display, chapters: getComputedStyle(document.querySelector('#chapters').closest('section')).display }));
    const ink = await canvasInk(page);
    check('embed shows only the movie', visible.library === 'none' && visible.chapters === 'none' && (await page.isVisible('#ovDate')) && ink > 20, `ink ${ink}`);
    await page.screenshot({ path: join(OUT, '7-embed.png') });
    await ctx.close();
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const p2 = await phone.newPage();
    await p2.goto(BASE);
    await p2.waitForTimeout(800);
    const swLib = await p2.evaluate(() => document.documentElement.scrollWidth);
    await p2.goto(BASE + '#/sample/opencode');
    await p2.waitForTimeout(2500);
    const sw = await p2.evaluate(() => document.documentElement.scrollWidth);
    check('no sideways scroll at phone width', sw <= 390 && swLib <= 390, `library ${swLib}, story ${sw}`);
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
  await app.close();
  offline.close();
  removeDir(libRoot);
  repos.forEach(removeDir);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in e2e/output/.`);
process.exit(failed.length ? 1 : 0);
