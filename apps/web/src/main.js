// Commit Wars web app: a library of collections and stories kept by the
// local server (apps/server), each story played as a movie you can scrub.
// Routes:
//   #/                        the library
//   #/s/collection/story      play a story from the library
//   #/c/collection            play all of a collection's stories as one movie
//   #/c/collection/dev/name   the same, following one developer
//   #/c/collection/p/id       a period's movie (a quarter or any dates); /dev/name follows one developer
//   #/c/collection/p/id/report   that period's report
//   a downloaded period file (window.__CW_SHARE__) plays its own movie; #/report, #/dev/name
//   #/sample/opencode         the bundled sample (works without the server)
//   ?embed=1                  movie only, autoplay, loops (for iframes)

import { createPlayer, SPEEDS } from '@commit-wars/player';
import { buildEpisode, parseGitLog, GIT_LOG_COMMAND, dayOfIso, chapterAt } from '@commit-wars/story-engine';
import { storage, dropLegacyCache } from './store.js';
import { createMovieUI } from './movie-ui.js';
import { api, subscribe, OFFLINE_MESSAGE } from './api.js';
import { createLibraryUI, ago } from './library-ui.js';
import { parseLibraryState, libraryStateHash } from './library-view.js';
import { createOrgUI } from './org-ui.js';
import { renderReport } from './report-ui.js';
import { createSound, cueFor } from './sound.js';

const $ = (s) => document.querySelector(s);
const fmtN = (n) => Number(n).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; };
const fmtMonth = (d) => { const [y, m] = d.split('-'); return `${MON[+m - 1]} ${y}`; };
const range = (ch) => { const a = fmtMonth(ch.first), b = fmtMonth(ch.last); return a === b ? a : `${a} – ${b}`; };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const params = new URLSearchParams(location.search);
const EMBED = params.has('embed');
if (EMBED) document.body.classList.add('embed');
// a period downloaded as one .html file: its movie and report are inside the page, there is no server
const SHARE = window.__CW_SHARE__ || null;
if (SHARE) document.body.classList.add('shared');

// ================= player =================
const player = createPlayer({ canvas: $('#stage'), autoplay: true, loop: EMBED || params.has('loop') });
if (params.has('debug') || navigator.webdriver) window.__cwPlayer = player; // tests read stage positions
let current = null; // { link, c, s } for the loaded episode

// ================= movie: player + overlays + timeline =================
const movie = $('#movie');
const ui = createMovieUI({ player, movie, screen: $('#screen'), onFollow: (name) => follow(name) });
player.on('time', (t) => {
  ui.onTime(t);
  document.querySelectorAll('.chap').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.i === t.chapter)));
});
player.on('state', (s) => {
  $('#playLabel').textContent = s.ended ? 'Replay' : s.playing ? 'Pause' : 'Play';
  $('#playIcon').innerHTML = s.playing && !s.ended ? '<path d="M7 5h4v14H7zM14 5h4v14h-4z"/>' : '<path d="M7 4l13 8-13 8z"/>';
  $('#bSpeed').textContent = s.speed + '×';
  document.querySelectorAll('.hero-card[data-name]').forEach((b) => b.setAttribute('aria-pressed', String(s.following === b.dataset.name)));
  const ml = $('#modeLabel'); ml.textContent = '';
  const b = document.createElement('b');
  if (s.following) { b.textContent = s.following; ml.append('Following ', b, ' · only their fixes and features'); }
  else { b.textContent = 'everyone'; ml.append('Showing ', b); }
  $('#bAll').hidden = !s.following;
  if (current && current.collection) setCrumbs({ collection: current.collection.name, story: s.following ? `${s.following} · all stories` : 'All stories' });
  if (current && current.period) setCrumbs({ collection: current.crumbs.collection, story: s.following ? `${s.following} · ${current.period.label}` : current.period.label });
});
// story beats become a one-line caption (and a polite announcement for screen readers)
player.on('spotlight', (e) => {
  let text = '';
  const files = (fx) => `${fx.repo ? ` in ${fx.repo}` : ''}${fx.files != null ? ` · ${fmtN(fx.files)} file${fx.files === 1 ? '' : 's'}` : ''}`;
  const built = (fx) => fx.kind === 'feat';
  if (e.kind === 'duel') text = built(e.fx) ? `Feature duel: ${e.hero} builds "${player.fixLabel(e.fx, 90)}"${files(e.fx)}` : `Duel: ${e.hero} vs "${player.fixLabel(e.fx, 90)}" · ${e.typeName}${files(e.fx)}`;
  else if (e.kind === 'duel-won') text = `${e.hero} ${built(e.fx) ? 'shipped' : 'fixed'} "${player.fixLabel(e.fx, 90)}"${e.combo > 1 ? ` with a ${e.combo}-hit combo` : ''}${files(e.fx)} · ${fmtDate(e.fx.d)}`;
  else if (e.kind === 'boss' && e.bossKind === 'feature') text = `Feature boss: ${e.who}'s "${e.s}". Beat its ${fmtN(e.commits)} commits, then ship it.`;
  else if (e.kind === 'boss' && e.commits) text = `Tech Debt: the chapter's biggest cleanup, ${e.who}'s "${e.s}". Beat its ${fmtN(e.commits)} commits, then finish it.`;
  else if (e.kind === 'boss') text = `Tech Debt: the chapter's biggest cleanup. ${e.who}'s "${e.s}"${e.files != null ? ` (${fmtN(e.files)} files)` : ''} will finish it.`;
  else if (e.kind === 'boss-open') text = `Shield down: ${e.title} can be hit now.`;
  else if (e.kind === 'hive') text = `${e.tag} is being built: this period's fixes and features come out of it.`;
  else if (e.kind === 'release-day') text = `Release day for ${e.tag}: break it open.`;
  else if (e.kind === 'boss-down' && e.info.kind === 'feature') text = `${e.hero} shipped "${e.info.s}"${e.info.files != null ? `: ${fmtN(e.info.files)} files` : ''}.`;
  else if (e.kind === 'boss-down') text = `${e.hero} refactored Tech Debt away${e.info.files != null ? `: ${fmtN(e.info.files)} files changed` : ''}.`;
  else if (e.kind === 'release') text = `Release ${e.tag} shipped on ${fmtDate(e.d)}.`;
  else if (e.kind === 'chapter') text = `Chapter ${e.k + 1}: ${e.title}`;
  if (text) $('#caption').textContent = text;
});
// quiet fight sounds; muted in embeds unless turned on there, and the choice is remembered
const sound = createSound({ muted: (storage.get('cw:sound') ?? (EMBED ? '0' : '1')) === '0' });
if (navigator.webdriver) window.__cwSound = sound; // tests count what would play
player.on('sfx', (e) => sound.play(e.kind));
player.on('spotlight', (e) => { const cue = cueFor(e); if (cue && player.playing) sound.play(cue); });
// audio can start only after the viewer touches the page
for (const t of ['pointerdown', 'keydown']) document.addEventListener(t, () => sound.unlock(), { capture: true, passive: true });
function setSound(on) {
  sound.setMuted(!on);
  storage.set('cw:sound', on ? '1' : '0');
  const b = $('#bSound');
  b.setAttribute('aria-pressed', String(on));
  b.title = `Sound ${on ? 'on' : 'off'} (M)`;
  $('#soundIcon').innerHTML = on ? '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>' : '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>';
}
function follow(name) {
  if (!player.follow(name)) return false;
  ui.setFollow(name);
  return true;
}

// legend and log icons
const ICONS = {
  duel: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"><rect x="4" y="5" width="16" height="12" rx="1" transform="rotate(-6 12 11)"/><path d="M8 11l3 3 6-6" stroke="var(--bug)" stroke-width="2.6" stroke-linecap="round"/></svg>',
  feat: '<svg viewBox="0 0 24 24" fill="var(--orb)" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
  revert: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--bug)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/></svg>',
  boss: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"><path d="M4 20L18 6M14 4h6v6M20 20L6 6M10 4H4v6"/></svg>',
  release: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"><path d="M5 21V3"/><path d="M5 4h13l-3 4 3 4H5" fill="var(--orb)"/></svg>',
  swarm: '<svg viewBox="0 0 24 24" fill="var(--bug)"><circle cx="6" cy="14" r="2"/><circle cx="11" cy="10" r="2"/><circle cx="15" cy="16" r="2"/><circle cx="19" cy="11" r="2"/></svg>',
};

// ================= page furniture for an episode =================
function figureSVG() { return '<svg viewBox="0 0 34 54" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="17" cy="8" r="6"/><path d="M11 6h12M17 14v18M17 32l-7 20M17 32l6 20M17 18l-9 4 2-7M17 18l10-4 2 7"/></svg>'; }
function buildChapters(ep) {
  const el = $('#chapters'); el.textContent = '';
  ep.chapters.forEach((ch, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.className = 'chap'; b.type = 'button'; b.dataset.i = i;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1).padStart(2, '0');
    const t = document.createElement('span'); t.className = 't'; t.textContent = ch.title;
    const d = document.createElement('span'); d.className = 'd'; d.textContent = `${range(ch)} · ${fmtN(ch.fixes)} fixes${ch.release ? ' · ' + ch.release.tag : ''}`;
    b.append(n, t, d);
    b.addEventListener('click', () => player.seek(dayOfIso(ep.timeline, ch.first)));
    li.append(b); el.append(li);
  });
}
function buildRoster(ep) {
  const el = $('#roster'); el.textContent = '';
  ep.roster.forEach((r) => {
    const has = true;
    const card = document.createElement(has ? 'button' : 'div'); card.className = 'hero-card'; card.style.color = player.colorVarOf(r.name);
    if (has) { card.type = 'button'; card.dataset.name = r.name; card.setAttribute('aria-pressed', 'false'); }
    if (r.avatarUrl) {
      const img = document.createElement('img'); img.className = 'av'; img.alt = ''; img.loading = 'lazy'; img.src = r.avatarUrl + (r.avatarUrl.includes('?') ? '&' : '?') + 's=72';
      img.addEventListener('error', () => { img.replaceWith(document.createRange().createContextualFragment(figureSVG())); });
      card.append(img);
    } else card.innerHTML = figureSVG();
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name;
    const st = document.createElement('span'); st.className = 'st'; st.textContent = `${fmtN(r.commits)} commits · ${fmtN(r.fixes)} fixes`;
    const fs = document.createElement('span'); fs.className = 'st'; fs.textContent = `since ${fmtMonth(r.first)}${r.areas && r.areas[0] ? ' · ' + r.areas[0].replace(/^packages\//, '') : ''}`;
    card.append(nm, st, fs);
    if (has) {
      const go = document.createElement('span'); go.className = 'go'; go.textContent = `Follow ${r.name}`; card.append(go);
      card.addEventListener('click', () => { follow(player.following === r.name ? null : r.name); $('#stageWrap').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); });
    }
    el.append(card);
  });
  if (ep.summary.botCommits) {
    const card = document.createElement('div'); card.className = 'hero-card'; card.style.color = 'var(--muted)';
    card.innerHTML = '<svg viewBox="0 0 34 54" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="8" width="16" height="12"/><rect x="7" y="22" width="20" height="18"/><circle cx="17" cy="46" r="6"/><path d="M17 8V2"/></svg>';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = 'Release bot';
    const st = document.createElement('span'); st.className = 'st'; st.textContent = `${fmtN(ep.summary.botCommits)} bot commits`;
    const fs = document.createElement('span'); fs.className = 'st'; fs.textContent = 'plants the release flags';
    card.append(nm, st, fs); el.append(card);
  }
}
const legendIcons = [];
function buildLegend() {
  const el = $('#legend'); el.textContent = '';
  const items = [
    ['gremlin', 'Gremlin', 'A terminal UI fix. Small, fast and jumpy.'],
    ['beetle', 'Perf Beetle', 'A performance, memory, cache or timeout fix. Armored, charges hard and can\'t be launched.'],
    ['crawler', 'Logic Crawler', 'Any other logic fix. Segmented and stubborn.'],
    ['wraith', 'Path Wraith', 'A Windows or file-path fix. Floats just out of reach.'],
    ['moth', 'Glitch Moth', 'A visual fix: layout, theme, scroll, rendering.'],
    ['bomb', 'Crash Bomb', 'A crash, hang, freeze or infinite-loop fix. Hits hardest.'],
    ['feature', 'Feature', 'Not a bug: a feature its author is building. Gold, heavy and slow; its health is the files it touched, and finishing it shows SHIPPED. Each chapter\'s biggest features become duels.'],
  ];
  for (const [type, t, d] of items) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const cv = document.createElement('canvas'); cv.width = 80; cv.height = 80; cv.setAttribute('aria-hidden', 'true'); dt.append(cv);
    const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = t; dt.append(sr);
    const dd1 = document.createElement('dd'); dd1.className = 'term'; dd1.setAttribute('aria-hidden', 'true'); dd1.textContent = t;
    const dd2 = document.createElement('dd'); dd2.textContent = d;
    div.append(dt, dd1, dd2); el.append(div);
    legendIcons.push([cv, type]);
  }
  const extra = [
    ['duel', 'Duel', 'Every fix enters on the day it landed and is fought by its author. Each chapter\'s biggest fixes become one-on-one duels; fixes that closed an issue are picked first. An enemy\'s health is the files the fix touched.'],
    ['swarm', 'Waiting fixes', 'Busy days bring more fixes than fit on stage. They wait at the right edge; ones left waiting three days count as squashed.'],
    ['boss', 'Tech Debt', 'The chapter boss: it arrives on the day of the chapter\'s biggest cleanup (a refactor, removal, migration or consolidation of at least 10 files), and that commit\'s author throws the finishing move. Features, docs and dependency bumps never count; a chapter without a real cleanup has no boss.'],
    ['release', 'Flag', 'A minor or major release, planted by the release bot. Bot accounts never fight; they ship.'],
  ];
  for (const [k, t, d] of extra) {
    const div = document.createElement('div');
    const dt = document.createElement('dt'); dt.innerHTML = ICONS[k];
    const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = t; dt.append(sr);
    const dd1 = document.createElement('dd'); dd1.className = 'term'; dd1.setAttribute('aria-hidden', 'true'); dd1.textContent = t;
    const dd2 = document.createElement('dd'); dd2.textContent = d;
    div.append(dt, dd1, dd2); el.append(div);
  }
  drawLegend();
}
function drawLegend() { for (const [cv, type] of legendIcons) player.drawEnemyIcon(cv, type); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(() => { player.redraw(); drawLegend(); }, 0));

function showEpisode(ep, meta) {
  player.load(ep);
  current = meta;
  ui.setEpisode(ep);
  buildChapters(ep);
  buildRoster(ep);
  const name = ep.summary.repo.split('/').pop();
  $('#repoTitle').textContent = ep.summary.repo === 'your repo' ? 'Your Commit Wars' : `The ${name} Commit Wars`;
  document.title = `${ep.summary.repo} · Commit Wars`;
  $('#footer').textContent = ep.summary.note || '';
  const note = $('#cacheNote');
  note.textContent = '';
  if (meta && meta.story) {
    note.append(`Updated ${ago(meta.story.fetchedAt)} · `);
    const b = document.createElement('button'); b.className = 'link'; b.type = 'button'; b.textContent = 'Update now';
    b.addEventListener('click', () => api.updateStory(meta.c, meta.s).then(() => showNotice('Checking for new commits…')).catch((e) => showError(e.message)));
    note.append(b);
    note.hidden = false;
  } else if (meta && meta.period) {
    // a period's movie links to its report and to the file for sharing
    const a = document.createElement('a'); a.href = meta.reportHref; a.textContent = `${meta.period.label} report`;
    note.append(a);
    if (meta.downloadHref) { const d = document.createElement('a'); d.href = meta.downloadHref; d.download = ''; d.textContent = 'Download for sharing'; note.append(' · ', d); }
    note.hidden = false;
  } else note.hidden = true;
  setCrumbs(meta && meta.crumbs);
  showView('story');
}

// ================= views and routing =================
function showView(v) {
  document.body.dataset.view = v;
  document.querySelectorAll('[data-view-only]').forEach((el) => { el.hidden = el.dataset.viewOnly !== v; });
}
function setCrumbs(c) {
  $('#crumbCol').textContent = c ? c.collection : '';
  $('#crumbStory').textContent = c ? c.story : '';
}
function showError(msg) {
  const el = $('#errorBox');
  el.hidden = !msg; el.textContent = msg || '';
}
function showNotice(msg, action) {
  const el = $('#storyNotice'); el.textContent = '';
  if (!msg) { el.hidden = true; return; }
  el.append(msg);
  if (action) { const b = document.createElement('button'); b.className = 'link'; b.type = 'button'; b.textContent = action.label; b.addEventListener('click', action.run); el.append(' ', b); }
  el.hidden = false;
}

let serverUp = null;
const lib = createLibraryUI({
  root: $('#collections'), select: $('#addCollection'), onError: (m) => showError(m), onServer: (up, canManage) => setServer(up, canManage),
  tools: { search: $('#libSearch'), status: $('#libStatus'), sort: $('#libSort'), count: $('#libCount') },
  // keep search, filter, sort and pages in the address, so reloading or sharing keeps the place
  onView: (v) => { if (document.body.dataset.view === 'library') history.replaceState(null, '', location.pathname + location.search + libraryStateHash(v)); },
});
function setServer(up, canManage = true) {
  serverUp = up;
  // watching from another machine: the page shows the library but no way to change it
  document.body.classList.toggle('watch-only', up && !canManage);
  $('#offline').hidden = up;
  $('#offlineMsg').textContent = OFFLINE_MESSAGE.replace(/`/g, '');
  document.querySelectorAll('#addForm input, #addForm button, #colForm input, #colForm button').forEach((el) => { el.disabled = !up; });
}
let waiting = null; // { c, s, id } story opened before its build finished
if (!SHARE) subscribe({
  onOpen: () => { if (serverUp === false) { setServer(true); lib.refresh(); } },
  onDown: () => { if (serverUp) setServer(false); },
  onLibrary: () => lib.refreshSoon(),
  onJob: (job) => {
    lib.onJob(job);
    if (job.kind === 'period' && current && current.period && current.period.id === job.periodId && current.c === (job.collection && job.collection.slug)) {
      if (job.state !== 'done') return;
      if (waiting) { waiting = null; route(); return; }
      if (job.changed && document.body.dataset.view === 'story') showNotice(`${current.period.label} was built again.`, { label: 'Reload it', run: () => route() });
      return;
    }
    if (job.kind === 'collection' && current && current.collection && job.collectionId === current.collection.id) {
      if (job.state !== 'done') return;
      if (waiting) { waiting = null; openCollection(current.c, player.following); return; }
      if (job.changed) showNotice('The combined movie was updated.', { label: 'Reload it', run: () => openCollection(current.c, player.following) });
      return;
    }
    if (!current || !current.story || job.storyId !== current.story.id) return;
    if (job.state === 'running' || job.state === 'queued') { if (!player.episode || waiting) showNotice(`${job.message || 'Working…'}`); return; }
    if (job.state === 'error') { showNotice(`The last ${job.kind} failed: ${job.message}`); return; }
    if (job.state === 'done' && waiting) { waiting = null; openStory(current.c, current.s); return; }
    if (job.state === 'done' && job.changed) showNotice('New commits are in.', { label: 'Reload the story', run: () => openStory(current.c, current.s) });
    else if (job.state === 'done') showNotice('');
  },
});

async function openLibrary() {
  showView('library');
  lib.setView(parseLibraryState(location.hash));
  setCrumbs(null);
  document.title = 'Library · Commit Wars';
  $('#repoTitle').textContent = 'Commit Wars';
  await lib.refresh();
}

async function openStory(c, s) {
  showError(''); showNotice('');
  await lib.refresh();
  const found = lib.find(c, s);
  if (!found || !found.story) { showView('library'); showError(serverUp === false ? '' : `There's no story "${s}" in "${c}". It may have been renamed or moved.`); return; }
  const { col, story } = found;
  const meta = { link: `#/s/${encodeURIComponent(c)}/${encodeURIComponent(s)}`, c, s, story, crumbs: { collection: col.name, story: story.name } };
  current = meta;
  if (!story.hasEpisode) {
    waiting = { c, s };
    setCrumbs(meta.crumbs); showView('story');
    showNotice(story.status === 'error' ? `This story didn't build: ${story.error}` : 'This story is still being built. It will start as soon as it is ready.');
    return;
  }
  try {
    showEpisode(await api.episode(c, s), meta);
  } catch (e) { showError(e.message); return; }
  // Opening a story that hasn't been fetched for a day checks for new commits in the background.
  if (story.setUp && story.status === 'ready' && (!story.fetchedAt || Date.now() - Date.parse(story.fetchedAt) > 864e5)) api.updateStory(c, s).catch(() => {});
}

async function openCollection(c, dev) {
  showError(''); showNotice('');
  await lib.refresh();
  const col = lib.collections.find((x) => x.slug === c);
  if (!col) { showView('library'); showError(serverUp === false ? '' : `There's no collection "${c}". It may have been renamed.`); return; }
  const enc = encodeURIComponent;
  const meta = { link: `#/c/${enc(c)}${dev ? `/dev/${enc(dev)}` : ''}`, c, collection: col, crumbs: { collection: col.name, story: dev ? `${dev} · all stories` : 'All stories' } };
  current = meta;
  let ep;
  try { ep = await api.collectionEpisode(c); }
  catch (e) {
    if (e.status === 404) { waiting = { c }; setCrumbs(meta.crumbs); showView('story'); showNotice(e.message); return; }
    showError(e.message); return;
  }
  showEpisode(ep, meta);
  if (dev && !follow(dev)) showNotice(`There's no developer named "${dev}" in ${col.name} now; showing everyone.`);
}

/** A period's place in the library, or a message saying why it can't open. */
async function findPeriod(c, id) {
  await lib.refresh();
  const col = lib.collections.find((x) => x.slug === c);
  if (!col) return { error: serverUp === false ? '' : `There's no collection "${c}". It may have been renamed.` };
  const p = (col.periods || []).find((x) => x.id === id);
  if (!p) return { error: `There's no period ${id} in ${col.name}. It may have been deleted.` };
  const enc = encodeURIComponent, base = `#/c/${enc(c)}/p/${enc(id)}`;
  return { col, p, base, downloadHref: api.periodShareUrl(c, id) };
}
const isBusy = (p) => ['queued', 'building'].includes(p.status);

async function openPeriod(c, id, dev) {
  showError(''); showNotice('');
  const f = await findPeriod(c, id);
  if (f.error != null) { showView('library'); showError(f.error); return; }
  const { col, p, base } = f;
  const meta = { link: `${base}${dev ? `/dev/${encodeURIComponent(dev)}` : ''}`, c, period: p, reportHref: `${base}/report`, downloadHref: f.downloadHref, crumbs: { collection: col.name, story: p.label } };
  current = meta;
  if (isBusy(p) || p.status === 'error' || !p.hasEpisode) {
    setCrumbs(meta.crumbs); showView('story');
    if (isBusy(p)) { waiting = { c, id }; showNotice(`${p.label} is being built. It will start as soon as it is ready.`); }
    else if (p.status === 'error') showNotice(`${p.label} didn't build: ${p.error}`);
    else showNotice(`${p.label} has too few commits for a movie.`, { label: 'Open its report', run: () => { location.hash = meta.reportHref; } });
    return;
  }
  try { showEpisode(await api.periodEpisode(c, id), meta); }
  catch (e) { showError(e.message); return; }
  if (dev && !follow(dev)) showNotice(`There's no developer named "${dev}" in ${p.label}; showing everyone.`);
}

function showReport(rep, o) {
  renderReport($('#reportView'), rep, o);
  setCrumbs(null);
  document.title = `${rep.collection} · ${rep.label} report · Commit Wars`;
  $('#repoTitle').textContent = `${rep.collection} · ${rep.label}`;
  showView('report');
  window.scrollTo(0, 0);
}

async function openPeriodReport(c, id) {
  showError(''); showNotice('');
  const f = await findPeriod(c, id);
  if (f.error != null) { showView('library'); showError(f.error); return; }
  const { p, base } = f;
  current = { link: `${base}/report`, c, period: p, crumbs: { collection: f.col.name, story: p.label } };
  if (isBusy(p) || !p.hasReport) {
    showView('library');
    showError(isBusy(p) ? `${p.label} is still being built. Its report opens from the library when it is ready.` : `${p.label} didn't build: ${p.error}`);
    return;
  }
  let rep;
  try { rep = await api.periodReport(c, id); } catch (e) { showError(e.message); return; }
  showReport(rep, { movieHref: p.hasEpisode ? base : null, devHref: p.hasEpisode ? (name) => `${base}/dev/${encodeURIComponent(name)}` : null, downloadHref: f.downloadHref, homeHref: '#/' });
}

/** A downloaded period file: the movie, or #/report, or #/dev/name following one developer. */
function routeShare() {
  const h = location.hash || '';
  const rep = SHARE.report;
  const reportOpts = { movieHref: SHARE.episode ? '#/' : null, devHref: SHARE.episode ? (name) => `#/dev/${encodeURIComponent(name)}` : null,
    note: `Made with Commit Wars on ${new Date(SHARE.madeAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, from git history only.` };
  if (h === '#/report' || !SHARE.episode) { showReport(rep, reportOpts); return; }
  const m = h.match(/^#\/dev\/(.+)$/);
  const meta = { link: null, shared: true, period: { id: `${rep.from}_${rep.to}`, label: rep.label }, reportHref: '#/report', downloadHref: null, crumbs: { collection: rep.collection, story: rep.label } };
  if (!player.episode) showEpisode(SHARE.episode, meta); else { current = meta; showView('story'); setCrumbs(meta.crumbs); }
  follow(m ? decodeURIComponent(m[1]) : null);
}

async function openSample(name) {
  showError(''); showNotice('');
  try {
    const res = await fetch(`./samples/${name}.json`);
    if (!res.ok) throw new Error(`The ${name} sample is missing from this build.`);
    showEpisode(await res.json(), { link: `#/sample/${name}`, crumbs: { collection: 'Samples', story: name } });
  } catch (e) { showError(e.message); }
}

function route() {
  if (SHARE) { routeShare(); return; }
  const h = location.hash || '';
  let m = h.match(/^#\/c\/([^/]+)\/p\/([^/]+)\/report$/);
  if (m) { openPeriodReport(decodeURIComponent(m[1]), decodeURIComponent(m[2])); return; }
  m = h.match(/^#\/c\/([^/]+)\/p\/([^/]+)(?:\/dev\/(.+))?$/);
  if (m) { openPeriod(decodeURIComponent(m[1]), decodeURIComponent(m[2]), m[3] ? decodeURIComponent(m[3]) : null); return; }
  m = h.match(/^#\/s\/([^/]+)\/([^/]+)$/);
  if (m) { openStory(decodeURIComponent(m[1]), decodeURIComponent(m[2])); return; }
  m = h.match(/^#\/c\/([^/]+)(?:\/dev\/(.+))?$/);
  if (m) { openCollection(decodeURIComponent(m[1]), m[2] ? decodeURIComponent(m[2]) : null); return; }
  m = h.match(/^#\/sample\/([\w-]+)$/);
  if (m || EMBED && !h) { openSample(m ? m[1] : 'opencode'); return; }
  m = h.match(/^#\/r\/([\w.-]+)\/([\w.-]+)/);
  openLibrary().then(() => {
    // old shared links: offer to add the repo to the library
    if (m) { $('#repoUrl').value = `https://github.com/${m[1]}/${m[2]}`; showError(`Links to GitHub repos now go through the library. Pick a collection and press Add story to build ${m[1]}/${m[2]}.`); }
  });
}
window.addEventListener('hashchange', route);

$('#addCollection').addEventListener('change', () => { $('#newColWrap').hidden = $('#addCollection').value !== '__new'; });
/** The collection picked in the add box, creating it first when "New collection…" is chosen. */
async function pickedCollection() {
  let c = $('#addCollection').value;
  if (!c || c === '__new') {
    const name = $('#newColName').value.trim() || (lib.collections.length ? '' : 'My stories');
    if (!name) { showError('Give the new collection a name.'); $('#newColName').focus(); return null; }
    const col = (await api.createCollection(name)).collection;
    await lib.refresh();
    $('#addCollection').value = col.slug; $('#newColWrap').hidden = true; $('#newColName').value = '';
    return { slug: col.slug, name: col.name };
  }
  const col = lib.collections.find((x) => x.slug === c);
  return { slug: c, name: col ? col.name : c };
}
createOrgUI({
  form: $('#orgForm'), input: $('#orgName'), list: $('#orgList'), collection: pickedCollection, onError: (m) => showError(m),
  onAdded: (r) => { lib.refresh(); if (r.skipped.length) showError(`Added ${r.added.length}; ${r.skipped.length} were already in the collection.`); },
});
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const url = $('#repoUrl').value.trim();
  if (!url) { showError('Paste a repository link, such as https://github.com/owner/repo, or a folder path on this machine.'); $('#repoUrl').focus(); return; }
  try {
    const picked = await pickedCollection();
    if (!picked) return;
    const c = picked.slug;
    await api.addStory(c, { url, name: $('#addName').value.trim(), branch: $('#addBranch').value.trim() });
    $('#repoUrl').value = ''; $('#addName').value = ''; $('#addBranch').value = ''; $('#newColName').value = '';
    await lib.refresh();
    $('#addCollection').value = c; $('#newColWrap').hidden = true;
  } catch (err) { showError(err.message); }
});
$('#colForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api.createCollection($('#colName').value); $('#colName').value = ''; showError(''); await lib.refresh(); }
  catch (err) { showError(err.message); }
});
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/sample/${b.dataset.sample}`; }));

// ================= controls =================
const chapterDays = () => { const ep = player.episode; return ep ? ep.chapters.map((ch) => dayOfIso(ep.timeline, ch.first)) : []; };
function jumpChapter(dir) {
  const ep = player.episode; if (!ep) return;
  const k = chapterAt(ep, player.day), days = chapterDays();
  // going back from inside a chapter returns to its start first
  const target = dir < 0 && player.day - days[k] > 3 ? k : Math.max(0, Math.min(days.length - 1, k + dir));
  player.seek(days[target]);
}
function setPanel(which, on) {
  movie.classList.toggle(which === 'people' ? 'no-people' : 'no-feed', !on);
  $(which === 'people' ? '#bPeople' : '#bFeed').setAttribute('aria-pressed', String(on));
  storage.set('cw:panel:' + which, on ? '1' : '0');
  ui.updateInsets();
}
const panelDefault = (which) => { const v = storage.get('cw:panel:' + which); return v == null ? movie.clientWidth >= 700 : v === '1'; };
setPanel('people', panelDefault('people'));
setPanel('feed', panelDefault('feed'));
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await movie.requestFullscreen();
  } catch { flash('This browser won\'t go full screen here.'); }
}
document.addEventListener('fullscreenchange', () => {
  const on = document.fullscreenElement === movie;
  $('#bFull').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  $('#fullIcon').innerHTML = on ? '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' : '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';
  setTimeout(() => ui.redraw(), 50);
});
$('#bPlay').addEventListener('click', () => player.toggle());
$('#bBack').addEventListener('click', () => player.seekBy(-7));
$('#bFwd').addEventListener('click', () => player.seekBy(7));
$('#bPrevCh').addEventListener('click', () => jumpChapter(-1));
$('#bNextCh').addEventListener('click', () => jumpChapter(1));
$('#bAll').addEventListener('click', () => follow(null));
$('#bSpeed').addEventListener('click', () => player.setSpeed(SPEEDS[(SPEEDS.indexOf(player.speed) + 1) % SPEEDS.length]));
$('#bPeople').addEventListener('click', () => setPanel('people', movie.classList.contains('no-people')));
$('#bFeed').addEventListener('click', () => setPanel('feed', movie.classList.contains('no-feed')));
$('#bFull').addEventListener('click', toggleFullscreen);
$('#bSound').addEventListener('click', () => setSound(sound.muted));
setSound(!sound.muted);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // typing fields keep their keys; the timeline slider keeps its arrows; buttons and links keep Space and Enter
  const t = e.target.closest ? e.target : document.body;
  if (t.closest('input:not([type=range]), textarea, select')) return;
  if (t.closest('input[type=range]') && e.key.startsWith('Arrow')) return;
  if (t.closest('button, a, summary') && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key.toLowerCase();
  if (document.body.dataset.view === 'library') { if (e.key === '/') { e.preventDefault(); lib.focusSearch(); } return; }
  if (e.key === ' ') { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? jumpChapter(1) : player.seekBy(7); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? jumpChapter(-1) : player.seekBy(-7); }
  else if (k === 'f') toggleFullscreen();
  else if (k === 'm') setSound(sound.muted);
  else if (k === 'p') setPanel('people', movie.classList.contains('no-people'));
  else if (k === 'l') setPanel('feed', movie.classList.contains('no-feed'));
});

// ================= share, export, import =================
function flash(msg) { const s = $('#shareStatus'); s.textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(() => { s.textContent = ''; }, 4000); }
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); flash(`${label} copied.`); }
  catch { window.prompt(`Copy the ${label.toLowerCase()}:`, text); }
}
const baseUrl = () => location.href.split('#')[0].split('?')[0];
$('#bShare').addEventListener('click', () => {
  if (current && current.shared) { flash('This movie is a file. To share it, send the file itself.'); return; }
  if (!current || !current.link) { flash('Episodes opened from a file have no link. Use Download episode to share it.'); return; }
  copy(baseUrl() + current.link, 'Link');
});
$('#bEmbed').addEventListener('click', () => {
  if (!current || !current.link) { flash('Episodes opened from a file can\'t be embedded by link.'); return; }
  const ep = player.episode;
  copy(`<iframe src="${baseUrl()}?embed=1${current.link}" width="800" height="560" style="border:0;max-width:100%" title="Commit Wars: ${ep.summary.repo}" loading="lazy"></iframe>`, 'Embed code');
});
$('#bDownload').addEventListener('click', () => {
  const ep = player.episode; if (!ep) return;
  const blob = new Blob([JSON.stringify(ep)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${ep.summary.repo.replace(/[^\w.-]+/g, '-')}.commit-wars.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
function readFile(input, onText) {
  const file = input.files && input.files[0]; if (!file) return;
  const fr = new FileReader();
  fr.onload = () => { try { onText(String(fr.result), file); } catch (e) { showError(e.message); } input.value = ''; };
  fr.onerror = () => showError('That file could not be read.');
  fr.readAsText(file);
}
$('#episodeFile').addEventListener('change', (e) => readFile(e.target, (text) => {
  let ep; try { ep = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  showError(''); showEpisode(ep, { link: null, crumbs: { collection: 'Files', story: ep.summary ? ep.summary.repo : 'episode' } });
  history.replaceState(null, '', baseUrl() + location.search);
  flash('Episode loaded from file.');
}));
$('#cmdText').textContent = GIT_LOG_COMMAND + ' > history.txt';
$('#bCopyCmd').addEventListener('click', () => copy($('#cmdText').textContent, 'Command'));
$('#logFile').addEventListener('change', (e) => readFile(e.target, (text, file) => {
  const base = file.name.replace(/\.(txt|log)$/i, '');
  const ep = buildEpisode(parseGitLog(text, { repoName: /^history$/i.test(base) ? 'your repo' : base }));
  showError(''); showEpisode(ep, { link: null, crumbs: { collection: 'Files', story: file.name } });
  history.replaceState(null, '', baseUrl() + location.search);
  $('#stageWrap').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}));

// ================= boot =================
dropLegacyCache();
buildLegend();
route();
