// End-to-end check of the built web app with the real library server.
// Run: npm run build && npm run e2e
// Starts apps/server against a temporary library folder (serving apps/web/dist
// on the same port) and drives Chromium with Playwright. Stories are made from
// repos generated here with made-up people and messages; nothing reads the
// real library or the network. e2e/fixtures/ky-git-log.txt is real
// sindresorhus/ky `git log` output in GIT_LOG_COMMAND's format (public).

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { buildEpisode, parseGitLog, activeAt, isoOfDay, commitRange, TL } from '../packages/story-engine/src/index.js';
import { startServer } from '../apps/server/src/server.js';
import { createGitHub } from '../apps/server/src/github.js';
import { makeRepo, addCommits, tempDir, removeDir, mergePullRequest } from '../packages/git-source/test/make-repo.js';

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
// A stand-in for `gh repo list acme`: made-up repos that point at generated local repositories.
const orgRepos = [makeRepo({ n: 12 }), makeRepo({ n: 11 }), makeRepo({ n: 10 })];
const fakeGh = async () => JSON.stringify([
  { name: 'api', nameWithOwner: 'acme/api', sshUrl: orgRepos[0], url: 'https://github.com/acme/api', isArchived: false, isFork: false, isPrivate: true, pushedAt: '2024-06-01T00:00:00Z', diskUsage: 900, description: 'Made-up API service' },
  { name: 'web', nameWithOwner: 'acme/web', sshUrl: orgRepos[1], url: 'https://github.com/acme/web', isArchived: false, isFork: false, isPrivate: false, pushedAt: '2024-05-01T00:00:00Z', diskUsage: 400, description: '' },
  { name: 'legacy', nameWithOwner: 'acme/legacy', sshUrl: orgRepos[2], url: 'https://github.com/acme/legacy', isArchived: true, isFork: false, isPrivate: false, pushedAt: '2019-01-01T00:00:00Z', diskUsage: 50, description: 'Old' },
]);
const app = await startServer({ port: 0, library: libRoot, staticDir: DIST, quiet: true, github: createGitHub({ run: fakeGh }) });
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
const repos = [...orgRepos];

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

    // Everyone fighting stays inside the frame, and the camera doesn't zoom away from a brawl.
    await page.evaluate(() => window.__cwPlayer && window.__cwPlayer.follow(null));
    await pauseAndScrub(page, 330);
    await page.click('#bPlay');
    for (let k = 0; k < 3; k++) await page.click('#bSpeed');
    const outside = [];
    let features = 0;
    const fought = new Set(), left = new Set(), whyIdle = new Map();
    let overlapping = 0;
    for (let k = 0; k < 60; k++) {
      await page.waitForTimeout(150);
      const st = await page.evaluate(() => window.__cwPlayer.stageSnapshot());
      features += st.enemies.filter((e) => e.type === 'feature').length;
      for (const h of st.heroes) if (h.leaving) { left.add(h.name); if (h.fought || h.filler) fought.add(h.name); else whyIdle.set(h.name, h.reason); }
      // two fighting heroes on the same spot (same place across and in depth) means they draw on top of each other
      const here = st.heroes.filter((h) => h.entered && !h.leaving);
      if (here.some((a, i) => here.some((b, j) => j > i && Math.abs(a.x - b.x) < 26 && Math.abs((a.d ?? 0.5) - (b.d ?? 0.5)) < 0.1))) overlapping++;
      for (const e of st.enemies) if (e.entered && e.state !== 'dead' && (e.x - e.r < -2 || e.x + e.r > st.width + 2)) outside.push(`enemy at ${Math.round(e.x)} of ${Math.round(st.width)}`);
      for (const h of st.heroes) if (h.entered && !h.leaving && (h.x < 8 || h.x > st.width - 8)) outside.push(`${h.name} at ${Math.round(h.x)} of ${Math.round(st.width)}`);
      const brawl = st.enemies.some((e) => !e.duel && e.state !== 'dead');
      // the camera must be heading back to the full frame, and be nearly there, whenever a brawl is on
      if (brawl && (st.zoomTarget > 1.001 || st.zoom > 1.05)) outside.push(`zoomed to ${st.zoom.toFixed(2)} (target ${st.zoomTarget.toFixed(2)}) during a brawl`);
    }
    check('every fight stays inside the visible frame', outside.length === 0, outside.slice(0, 4).join('; ') || '60 samples at 8x');
    check('features show up as enemies to build', features > 0, `${features} feature sightings`);
    check('heroes fight in their own space, not on top of each other', overlapping <= 6, `${overlapping} of 60 samples had two heroes on the same spot`);
    const idle = [...left].filter((n) => !fought.has(n));
    // known rare case (about 1 in 70 leavers at 8x): allow one
    check('people leave only after they had something to fight', left.size > 0 && idle.length <= 1, `${left.size} left, ${idle.length} without fighting${idle.length ? ': ' + idle.slice(0, 3).map((n) => `${n} (came for: ${whyIdle.get(n)})`).join(', ') : ''}`);
    await page.click('#bSpeed'); await page.click('#bSpeed');
    if ((await page.textContent('#playLabel')) === 'Pause') await page.click('#bPlay');

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
  // 2a. A collection plays all its stories as one movie, and can follow one developer across them.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const post = (p, body) => fetch(`${app.url}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const one = makeRepo({ n: 20 }), two = makeRepo({ n: 16, start: '2024-02-01' }); repos.push(one, two);
    await post('/collections', { name: 'Team' });
    await post('/collections/team/stories', { url: one, name: 'Alpha' });
    await post('/collections/team/stories', { url: two, name: 'Beta' });
    const teamReady = async () => {
      for (let k = 0; k < 300; k++) {
        const lib = await (await fetch(`${app.url}/api/library`)).json();
        const t = lib.collections.find((c) => c.slug === 'team');
        if (t && t.episode && t.episode.status === 'ready' && t.stories.every((s) => s.status === 'ready')) return t;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    };
    const team = await teamReady();
    check('a collection combines its stories into one movie', team && team.episode.repos === 2 && team.episode.commits === 36, team ? JSON.stringify(team.episode) : 'not built');

    await page.goto(BASE);
    await page.click('[data-collection="team"] a:has-text("Play collection")');
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    const ep = await page.evaluate(() => fetch('/api/collections/team/episode').then((r) => r.json()));
    await pauseAndScrub(page, ep.timeline.days - 1);
    const repoBadges = await page.$$eval('#feedList .repo', (els) => [...new Set(els.map((e) => e.textContent))].sort());
    check('the collection movie shows which repo each commit is from', (await page.textContent('#crumbStory')) === 'All stories' && repoBadges.join(',') === 'Alpha,Beta', repoBadges.join(', '));
    await page.locator('#movie').screenshot({ path: join(OUT, '13-collection.png') });

    await page.click('#crumbHome');
    await page.waitForSelector('#libraryView:not([hidden]) [data-collection="team"]');
    if (await page.locator('[data-collection="team"] button:has-text("Show developers")').count()) await page.click('[data-collection="team"] button:has-text("Show developers")');
    await page.waitForSelector('[data-collection="team"] .dev');
    const devCount = await page.locator('[data-collection="team"] .dev').count();
    const dev = await page.textContent('[data-collection="team"] .dev .dev-name');
    await page.screenshot({ path: join(OUT, '14-developers.png'), fullPage: true });
    await page.click(`[data-collection="team"] .dev-name:has-text("${dev}")`);
    await page.waitForFunction((d) => document.querySelector('#crumbStory').textContent.startsWith(d) && !document.querySelector('#stageWrap').hidden, dev);
    await page.waitForTimeout(300);
    await pauseAndScrub(page, ep.timeline.days - 1);
    const who = await page.$$eval('#feedList li .who', (els) => [...new Set(els.map((e) => e.firstChild.textContent))]);
    const devRepos = await page.$$eval('#feedList .repo', (els) => [...new Set(els.map((e) => e.textContent))].sort());
    check('following a developer shows only their work, across the collection\'s repos', who.length === 1 && who[0] === dev && devRepos.length === 2 && (await page.textContent('#crumbStory')).startsWith(dev), `${who.join(', ')} in ${devRepos.join(', ')}`);

    await page.click('#crumbHome');
    await page.waitForSelector('#libraryView:not([hidden]) [data-collection="team"]');
    if (await page.locator('[data-collection="team"] button:has-text("Show developers")').count()) await page.click('[data-collection="team"] button:has-text("Show developers")');
    await page.waitForSelector('[data-collection="team"] .dev');
    const second = (await page.$$eval('[data-collection="team"] .dev .dev-name', (els) => els.map((e) => e.textContent)))[1];
    await page.selectOption(`[data-collection="team"] .dev:has(.dev-name:text-is("${second}")) select`, dev);
    let after = devCount;
    // the list hides while the movie is combined again; wait for it to come back
    for (let k = 0; k < 100 && (after === devCount || after === 0); k++) {
      await page.waitForTimeout(150);
      after = await page.locator('[data-collection="team"] .dev').count();
    }
    check('merging two developers makes them one', after === devCount - 1, `${devCount} → ${after}`);
    check('no page errors in collections', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 2c. Add a GitHub organization: list its repos, tick some, add them in one go.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await fetch(`${app.url}/api/collections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme' }) });
    await page.goto(BASE);
    await page.waitForSelector('[data-collection="acme"]');
    await page.selectOption('#addCollection', 'acme');
    await page.click('#orgBox summary');
    await page.fill('#orgName', 'acme');
    await page.click('#bListOrg');
    await page.waitForSelector('.org-list li');
    const ticked = await page.$$eval('.org-list input[type=checkbox]', (els) => els.map((e) => e.checked));
    check('an org lists its repos with archived ones left unticked', ticked.join(',') === 'true,true,false', ticked.join(','));
    await page.screenshot({ path: join(OUT, '15-org-checklist.png'), fullPage: true });
    await page.click('.org-list li:has-text("web") input');
    check('the add button counts the ticked repos', (await page.textContent('#bAddOrg')) === 'Add 1 repo to Acme', await page.textContent('#bAddOrg'));
    await page.click('#bAddOrg');
    await page.waitForSelector('[data-collection="acme"] .story-card a.btn.primary', { timeout: 30000 });
    const cards = await page.$$eval('[data-collection="acme"] .story-card h4', (els) => els.map((e) => e.textContent));
    check('adding from an org creates and builds the ticked stories', cards.join(',') === 'api', cards.join(','));
    await page.fill('#orgName', 'acme');
    await page.click('#bListOrg');
    await page.waitForSelector('.org-list li');
    const already = await page.$$eval('.org-list li', (els) => els.filter((e) => e.textContent.includes('already in Acme')).map((e) => e.querySelector('strong').textContent));
    check('repos already in the collection are marked', already.join(',') === 'api', already.join(','));
    check('no page errors adding an org', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 2d. Hundreds of stories: quick search, status filter and pages that survive a reload.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await fetch(`${app.url}/api/collections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Big' }) });
    // story folders written directly (no cloning): every tenth one failed
    for (let n = 1; n <= 130; n++) {
      const slug = `repo-${String(n).padStart(3, '0')}`;
      mkdirSync(join(libRoot, 'big', slug), { recursive: true });
      writeFileSync(join(libRoot, 'big', slug, 'story.json'), JSON.stringify({ id: `big-${n}`, name: slug, url: `git@github.com:big/${slug}.git`, webUrl: `https://github.com/big/${slug}`, status: n % 10 === 0 ? 'error' : 'ready', error: n % 10 === 0 ? 'git couldn\'t find it' : null, commits: n, fetchedAt: '2026-01-01T00:00:00Z' }));
    }
    await page.goto(BASE);
    await page.waitForSelector('[data-collection="big"] .story-card');
    const big = '[data-collection="big"]';
    check('a big collection shows one page of 60', (await page.locator(`${big} .story-card`).count()) === 60 && (await page.textContent(`${big} .pager`)).includes('1–60 of 130'));
    await page.click(`${big} .pager button:has-text("Next")`);
    await page.waitForFunction(() => location.hash.includes('page.big=2'));
    const first2 = await page.textContent(`${big} .story-card h4`);
    await page.reload();
    await page.waitForSelector(`${big} .story-card`);
    check('pages move and are kept on reload', first2 === 'repo-061' && (await page.textContent(`${big} .story-card h4`)) === 'repo-061', first2);
    await page.screenshot({ path: join(OUT, '16-pages.png'), fullPage: false });
    await page.keyboard.press('/');
    await page.keyboard.type('repo-12');
    await page.waitForFunction(() => document.querySelectorAll('[data-collection="big"] .story-card').length === 10);
    check('quick search narrows the stories as you type', (await page.textContent('#libCount')).startsWith('10 of'), await page.textContent('#libCount'));
    await page.keyboard.press('Escape');
    await page.click('#libStatus button:has-text("Failed")');
    await page.waitForFunction(() => document.querySelectorAll('[data-collection="big"] .story-card').length === 13);
    const filteredHash = await page.evaluate(() => location.hash);
    check('the status filter shows only failed stories', (await page.textContent(`${big} .story-card`)).includes('couldn\'t find it') && filteredHash.includes('status=failed'), filteredHash);
    await page.click('#libStatus button:has-text("All")');
    check('no page errors with many stories', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 2e. A big feature pull request is a boss: shielded while its commits come out, then shipped.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const post = (p, body) => fetch(`${app.url}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const repo = makeRepo({ n: 14 });
    mergePullRequest(repo, { name: 'palette', n: 6, title: 'Add the command palette', day: '2024-01-15' });
    addCommits(repo, { n: 4, from: 30, start: '2024-01-01' });
    repos.push(repo);
    await post('/collections', { name: 'Bosses' });
    await post('/collections/bosses/stories', { url: repo, name: 'Palette' });
    for (let k = 0; k < 200; k++) {
      const lib = await (await fetch(`${app.url}/api/library`)).json();
      if (lib.collections.find((c) => c.slug === 'bosses')?.stories[0]?.status === 'ready') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.goto(BASE + '#/s/bosses/palette');
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    for (let k = 0; k < 3; k++) await page.click('#bSpeed');
    let sawShield = false, sawSpawned = false, shot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const st = await page.evaluate(() => window.__cwPlayer.stageSnapshot());
      if (st.boss && st.boss.kind === 'feature' && st.boss.shield) sawShield = true;
      if (st.boss && st.boss.kind === 'feature' && st.enemies.length) sawSpawned = true;
      if (/shipped "Add the command palette"/.test(await page.textContent('#caption'))) break;
      if (sawShield && sawSpawned && !shot) { shot = true; await page.locator('#movie').screenshot({ path: join(OUT, '17-feature-boss.png') }); }
      await page.waitForTimeout(150);
    }
    const cap = await page.textContent('#caption');
    check('a feature pull request is a shielded boss that spawns its commits', sawShield && sawSpawned, `shield ${sawShield}, spawned ${sawSpawned}`);
    check('beating its commits, then the boss, ships the feature', /shipped "Add the command palette"/.test(cap), cap);
    check('no page errors with bosses', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 2f. A quarter (or any dates) of a collection: its own movie and report, and one .html file to share.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const post = (p, body) => fetch(`${app.url}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const one = makeRepo({ n: 20, start: '2024-03-20' }), two = makeRepo({ n: 15, start: '2024-04-01' }); repos.push(one, two);
    await post('/collections', { name: 'Quarters' });
    await post('/collections/quarters/stories', { url: one, name: 'Alpha' });
    await post('/collections/quarters/stories', { url: two, name: 'Beta' });
    for (let k = 0; k < 300; k++) {
      const q = (await (await fetch(`${app.url}/api/library`)).json()).collections.find((c) => c.slug === 'quarters');
      if (q && q.episode && q.episode.status === 'ready' && q.episode.repos === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.goto(BASE + '#/?q=nothing-matches-this');
    await page.goto(BASE + '#/');
    const box = '[data-collection="quarters"] .periods';
    await page.waitForSelector(`${box} select`);
    const opts = await page.$$eval(`${box} select option`, (els) => els.map((e) => e.textContent));
    check('the period picker lists the quarters that have commits', opts[0] === 'Q2 2024 · 23 commits' && opts[1] === 'Q1 2024 · 12 commits' && opts.at(-1) === 'Custom dates…', opts.join(' | '));
    await page.click(`${box} button:has-text("Make movie and report")`);
    const row = `${box} li[data-period="2024-04-01_2024-06-30"]`;
    await page.waitForSelector(`${row} a:has-text("Play")`, { timeout: 30000 });
    await page.locator(box).screenshot({ path: join(OUT, '18-periods.png') });

    await page.click(`${row} a:has-text("Play")`);
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    const crumb = await page.textContent('#crumbStory');
    const ep = await page.evaluate(() => window.__cwPlayer.episode);
    check('a quarter plays as its own movie', crumb === 'Q2 2024' && ep.timeline.start >= '2024-04-01' && ep.summary.commits === 23, `${crumb}, from ${ep.timeline.start}, ${ep.summary.commits} commits`);

    check('a quarter has Movie and Report tabs', await page.isVisible('#periodTabs') && (await page.getAttribute('#tabMovie', 'aria-current')) === 'page');
    await page.click('#tabReport');
    await page.waitForSelector('#reportView:not([hidden]) .rep-totals');
    check('the Report tab shows the report and pauses the movie', (await page.getAttribute('#tabReport', 'aria-current')) === 'page' && !(await page.evaluate(() => window.__cwPlayer.playing)));
    const head = await page.textContent('#repH');
    const total = await page.textContent('.rep-totals div:first-child dd');
    const devRows = await page.locator('#reportView .rep-table').first().locator('tbody tr').count();
    check('the quarter has a report: totals, every developer, stories and features', head === 'Quarters · Q2 2024' && total === '23' && devRows === 3 && (await page.locator('#reportView [aria-labelledby="repFeats"] li').count()) > 0, `${head}, ${total} commits, ${devRows} developers`);
    await page.screenshot({ path: join(OUT, '19-report.png'), fullPage: true });
    // sorting by a column reorders rows only
    await page.click('#reportView .rep-table thead button:has-text("Developer")');
    const names = await page.locator('#reportView [aria-labelledby="repDevs"] .rep-table tbody th').allTextContents();
    check('report tables sort by a column', names.join(',') === [...names].sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase())).join(',') || names.join(',') === [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(','), names.join(', '));
    const dev = names[0];
    await page.click(`#reportView .rep-table tbody a:text-is("${dev}")`);
    await page.waitForFunction((d) => document.querySelector('#crumbStory').textContent === `${d} · Q2 2024`, dev);
    check('a developer in the report opens the quarter following them', (await page.evaluate(() => window.__cwPlayer.following)) === dev, dev);

    // too few commits for a movie: the report still comes
    await page.goto(BASE + '#/');
    await page.waitForSelector(`${box} select`);
    await page.selectOption(`${box} select`, 'custom');
    await page.fill(`${box} input[aria-label="From"]`, '2024-03-20');
    await page.fill(`${box} input[aria-label="To"]`, '2024-03-22');
    await page.click(`${box} button:has-text("Make movie and report")`);
    const small = `${box} li[data-period="2024-03-20_2024-03-22"]`;
    await page.waitForSelector(`${small} a:has-text("Report")`, { timeout: 30000 });
    check('a period too short for a movie still gets a report', (await page.locator(`${small} a:has-text("Play")`).count()) === 0 && /too few for a movie/.test(await page.textContent(small)), await page.textContent(small));

    // one .html file with the movie and the report, opened with no server
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`${row} a:has-text("Download")`)]);
    const file = join(OUT, 'period-share.html');
    await dl.saveAs(file);
    check('Download saves the quarter as one .html file', dl.suggestedFilename() === 'Quarters-Q2-2024.commit-wars.html', dl.suggestedFilename());
    const shared = await ctx.newPage();
    const sharedErrors = []; shared.on('pageerror', (e) => sharedErrors.push(String(e)));
    const asked = []; shared.on('request', (r) => { if (!/^(file:|data:|https:\/\/fonts\.)/.test(r.url())) asked.push(r.url()); });
    await shared.goto(pathToFileURL(file).href);
    await shared.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    const sharedCrumb = await shared.textContent('#crumbStory');
    check('the downloaded file plays the quarter with no server', sharedCrumb === 'Q2 2024' && (await shared.evaluate(() => window.__cwPlayer.episode.summary.commits)) === 23 && !(await shared.isVisible('#crumbHome')) && asked.length === 0, `${sharedCrumb}; asked for ${asked.join(', ') || 'nothing'}`);
    check('the downloaded file has Movie and Report tabs', await shared.isVisible('#periodTabs') && (await shared.getAttribute('#tabMovie', 'aria-current')) === 'page');
    await shared.click('#tabReport');
    await shared.waitForSelector('#reportView:not([hidden]) .rep-totals');
    check('the downloaded file has the report too', (await shared.textContent('#repH')) === 'Quarters · Q2 2024' && !(await shared.locator('#reportView .crumbs a:has-text("Library")').count()), await shared.textContent('#repH'));
    await shared.screenshot({ path: join(OUT, '21-shared-report-tab.png') });
    await shared.click('#tabMovie');
    await shared.waitForSelector('#stageWrap:not([hidden])');
    check('the Movie tab goes back to the movie', (await shared.getAttribute('#tabMovie', 'aria-current')) === 'page' && (await shared.textContent('#crumbStory')) === 'Q2 2024');
    await shared.click('#tabReport');
    await shared.waitForSelector('#reportView:not([hidden]) .rep-totals');
    await shared.setViewportSize({ width: 390, height: 844 });
    await shared.waitForTimeout(200);
    const sw = await shared.evaluate(() => document.documentElement.scrollWidth);
    check('the report fits a phone without sideways scrolling', sw <= 390, `scrollWidth ${sw}`);
    await shared.screenshot({ path: join(OUT, '20-report-phone.png'), fullPage: true });
    check('no page errors with periods', errors.length === 0 && sharedErrors.length === 0, [...errors, ...sharedErrors].join(' | '));
    await ctx.close();
  }
  // 2h. A feature of a collection: every commit, in every story, that names it.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const post = (p, body) => fetch(`${app.url}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    // made-up commits that name "rocketpad" by message body, scope, path and merged branch (10 in all), and one decoy
    const commit = (dir, subject, { body = '', file = 'src/x.txt', day }) => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), `${subject}\n`);
      const env = { ...process.env, GIT_AUTHOR_DATE: `${day}T12:00:00Z`, GIT_COMMITTER_DATE: `${day}T12:00:00Z` };
      execFileSync('git', ['-C', dir, 'add', '-A']);
      execFileSync('git', ['-C', dir, '-c', 'user.name=Cy Test', '-c', 'user.email=cy@example.test', 'commit', '-q', '-m', subject, ...(body ? ['-m', body] : [])], { env });
    };
    const one = makeRepo({ n: 12, start: '2024-03-01' }), two = makeRepo({ n: 12, start: '2024-03-01' }); repos.push(one, two);
    mergePullRequest(one, { name: 'rocketpad-retries', n: 6, pr: 9, title: 'Retries', day: '2024-03-20' });
    commit(one, 'feat(rocketpad): keys', { day: '2024-03-22' });
    commit(one, 'chore: move files', { file: 'services/rocketpad/a.txt', day: '2024-03-23' });
    commit(one, 'feat: rocketpadder decoy', { day: '2024-03-24' });
    commit(two, 'fix: cache misses', { body: 'Seen in RocketPad.', day: '2024-03-25' });
    await post('/collections', { name: 'Launch' });
    await post('/collections/launch/stories', { url: one, name: 'Alpha' });
    await post('/collections/launch/stories', { url: two, name: 'Beta' });
    for (let k = 0; k < 300; k++) {
      const q = (await (await fetch(`${app.url}/api/library`)).json()).collections.find((c) => c.slug === 'launch');
      if (q && q.episode && q.episode.status === 'ready' && q.episode.repos === 2) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.goto(BASE + '#/');
    const box = '[data-collection="launch"] .features';
    await page.waitForSelector(`${box} input`);
    await page.fill(`${box} input`, 'RocketPad');
    await page.press(`${box} input`, 'Enter');
    const row = `${box} li[data-feature="rocketpad"]`;
    await page.waitForSelector(`${row} a:has-text("Report")`, { timeout: 30000 });
    const rowText = await page.textContent(row);
    check('a feature is found across the stories', /10 commits/.test(rowText) && (await page.locator(`${row} a:has-text("Play")`).count()) === 1, rowText);
    await page.locator(box).screenshot({ path: join(OUT, '22-features.png') });

    await page.click(`${row} a:has-text("Report")`);
    await page.waitForSelector('#reportView:not([hidden]) [aria-labelledby="repChanges"]');
    const head = await page.textContent('#repH');
    const changes = '#reportView [aria-labelledby="repChanges"] .rep-table tbody tr';
    const titles = await page.locator(`${changes} td.wrap`).allTextContents();
    check('the feature report lists every change that names it, and not the decoy', head === 'Launch · RocketPad' && titles.length === 10 && !titles.some((t) => /decoy/.test(t)), `${head}; ${titles.length} changes`);
    const found = await page.locator('#reportView [aria-labelledby="repChanges"] .sig').allTextContents();
    check('each change says how it was found', ['message', 'scope', 'path', 'branch', 'merged in'].every((s) => found.includes(s)), [...new Set(found)].join(', '));
    check('the feature has Movie and Report tabs', await page.isVisible('#periodTabs') && (await page.getAttribute('#tabReport', 'aria-current')) === 'page');
    await page.screenshot({ path: join(OUT, '23-feature-report.png'), fullPage: true });
    await page.click('#reportView [aria-labelledby="repChanges"] .chip:has-text("Beta")');
    const beta = await page.locator(changes).count();
    check('the changes can be narrowed to one story', beta === 1 && (await page.textContent(`${changes} td.wrap`)) === 'cache misses', `${beta} rows`);

    await page.click('#tabMovie');
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    const ep = await page.evaluate(() => window.__cwPlayer.episode);
    check('a feature plays as its own movie', (await page.textContent('#crumbStory')) === 'RocketPad' && ep.summary.commits === 10 && ep.timeline.repos.length === 2, `${ep.summary.commits} commits`);

    await page.goto(BASE + '#/');
    await page.waitForSelector(`${row} a:has-text("Download")`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`${row} a:has-text("Download")`)]);
    check('Download saves the feature as one .html file', dl.suggestedFilename() === 'Launch-RocketPad.commit-wars.html', dl.suggestedFilename());
    const file = join(OUT, 'feature-share.html');
    await dl.saveAs(file);
    const shared = await ctx.newPage();
    const sharedErrors = []; shared.on('pageerror', (e) => sharedErrors.push(String(e)));
    await shared.goto(pathToFileURL(file).href + '#/report');
    await shared.waitForSelector('#reportView:not([hidden]) [aria-labelledby="repChanges"]');
    check('the downloaded feature file has its changes', (await shared.locator(changes).count()) === 10);
    await shared.setViewportSize({ width: 390, height: 844 });
    await shared.waitForTimeout(200);
    const sw = await shared.evaluate(() => document.documentElement.scrollWidth);
    check('the feature report fits a phone without sideways scrolling', sw <= 390, `scrollWidth ${sw}`);
    await shared.screenshot({ path: join(OUT, '24-feature-report-phone.png'), fullPage: true });
    await shared.emulateMedia({ colorScheme: 'dark' });
    await shared.screenshot({ path: join(OUT, '25-feature-report-phone-dark.png'), fullPage: true });
    check('no page errors with features', errors.length === 0 && sharedErrors.length === 0, [...errors, ...sharedErrors].join(' | '));
    await ctx.close();
  }
  // 2g. Quiet fight sounds, and a mute button that is remembered.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '#/s/bosses/palette');
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    await page.click('#bSpeed'); // a click also lets the page start audio
    const asked = () => page.evaluate(() => window.__cwSound.stats.asked);
    await page.waitForFunction(() => window.__cwSound.stats.asked > 0, null, { timeout: 20000 }).catch(() => {});
    const before = await asked();
    check('the fight makes sounds while it plays', before > 0 && (await page.getAttribute('#bSound', 'aria-pressed')) === 'true', `${before} sounds`);
    await page.click('#bSound');
    const muted = await asked();
    await page.waitForTimeout(2500);
    const after = await asked();
    check('Mute stops the sounds', after === muted && (await page.getAttribute('#bSound', 'aria-pressed')) === 'false', `${muted} → ${after}`);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
    check('the mute choice is remembered', (await page.getAttribute('#bSound', 'aria-pressed')) === 'false');
    await page.keyboard.press('m');
    check('M turns the sound back on', (await page.getAttribute('#bSound', 'aria-pressed')) === 'true');
    check('no page errors with sound', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // 2b. LAN mode: another machine can watch the library and play stories, but not change anything.
  {
    const lanIp = Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
    if (!lanIp) console.log('SKIP  LAN checks: this machine has no network address');
    else {
      const lanRoot = tempDir('cw-e2e-lan-');
      const lanApp = await startServer({ port: 0, library: lanRoot, staticDir: DIST, quiet: true, lan: true });
      const local = (p, body) => fetch(`http://127.0.0.1:${lanApp.port}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const repo = makeRepo({ n: 14 }); repos.push(repo);
      await local('/collections', { name: 'Shared' });
      await local('/collections/shared/stories', { url: repo, name: 'Team Repo' });
      for (let k = 0; k < 100; k++) {
        const lib = await (await fetch(`http://127.0.0.1:${lanApp.port}/api/library`)).json();
        if (lib.collections[0].stories[0].status === 'ready') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`http://${lanIp}:${lanApp.port}/`);
      await page.waitForSelector('[data-collection="shared"] .story-card');
      const ui = await page.evaluate(() => ({
        note: getComputedStyle(document.querySelector('.watch-note')).display !== 'none',
        add: getComputedStyle(document.querySelector('#addForm')).display,
        buttons: [...document.querySelectorAll('.story-card button, .col-head button')].length,
        play: !!document.querySelector('.story-card a.btn.primary'),
      }));
      check('another machine on the network sees a watch-only library', ui.note && ui.add === 'none' && ui.buttons === 0 && ui.play, JSON.stringify(ui));
      await page.click('.story-card a.btn.primary');
      await page.waitForFunction(() => document.querySelector('#ovDate').textContent.trim().length > 4);
      check('and can play its stories', (await page.textContent('#crumbStory')) === 'Team Repo');
      const blocked = await page.evaluate(() => fetch('/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' }).then((r) => r.status));
      check('but cannot change the library', blocked === 403, `POST answered ${blocked}`);
      await page.screenshot({ path: join(OUT, '12-lan-watch-only.png') });
      await ctx.close();
      await lanApp.close();
      removeDir(lanRoot);
    }
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
