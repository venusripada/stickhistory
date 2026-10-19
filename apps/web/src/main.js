// Commit Wars web app: paste a GitHub link, fetch its history in the
// browser, build the story, and play it as a movie you can scrub. Routes:
//   #/r/owner/repo            build (or load from cache) and play a repo
//   #/r/owner/repo/tree/name  same, on another branch
//   #/sample/opencode         the bundled sample
//   ?embed=1                  stage only, autoplay, loops (for iframes)

import { createPlayer, SPEEDS } from '@commit-wars/player';
import { fetchHistory, parseRepoUrl, GitHubError, DEFAULT_LIMITS } from '@commit-wars/github-fetcher';
import { buildEpisode, parseGitLog, GIT_LOG_COMMAND, dayOfIso, chapterAt } from '@commit-wars/story-engine';
import { cacheGet, cacheSet, storage, dropLegacyCache } from './store.js';
import { createMovieUI } from './movie-ui.js';

const $ = (s) => document.querySelector(s);
const fmtN = (n) => Number(n).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; };
const fmtMonth = (d) => { const [y, m] = d.split('-'); return `${MON[+m - 1]} ${y}`; };
const range = (ch) => { const a = fmtMonth(ch.first), b = fmtMonth(ch.last); return a === b ? a : `${a} – ${b}`; };
const fixTitle = (fx) => (fx.issues && fx.issues.length && fx.issues[0].title) || fx.t;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ago = (iso) => {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
};

const params = new URLSearchParams(location.search);
const EMBED = params.has('embed');
if (EMBED) document.body.classList.add('embed');

// ================= player =================
const player = createPlayer({ canvas: $('#stage'), autoplay: true, loop: EMBED || params.has('loop') });
let current = null; // { key, label, link } for the loaded episode

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
});
// story beats become a one-line caption (and a polite announcement for screen readers)
player.on('spotlight', (e) => {
  let text = '';
  if (e.kind === 'duel') text = `Duel: ${e.hero} vs ${player.fixTag(e.fx)} · ${e.typeName} · ${fixTitle(e.fx)}${e.fx.files != null ? ` · ${fmtN(e.fx.files)} files` : ''}`;
  else if (e.kind === 'duel-won') text = `${e.hero} fixed ${player.fixTag(e.fx)}${e.combo > 1 ? ` with a ${e.combo}-hit combo` : ''} · ${fmtDate(e.fx.d)}`;
  else if (e.kind === 'boss') text = `Tech Debt appears. ${e.who}'s "${e.s}"${e.files != null ? ` (${fmtN(e.files)} files)` : ''} will finish it.`;
  else if (e.kind === 'boss-down') text = `${e.hero} refactored Tech Debt away${e.info.files != null ? `: ${fmtN(e.info.files)} files changed` : ''}.`;
  else if (e.kind === 'release') text = `Release ${e.tag} shipped on ${fmtDate(e.d)}.`;
  else if (e.kind === 'feature') text = `${e.who} powers up: ${e.fx.s}`;
  else if (e.kind === 'chapter') text = `Chapter ${e.k + 1}: ${e.title}`;
  if (text) $('#caption').textContent = text;
});
function follow(name) {
  if (!player.follow(name)) return;
  ui.setFollow(name);
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
    ['boss', 'Tech Debt', 'The chapter boss arrives on the day of the era\'s largest refactor, and its author throws the finishing move.'],
    ['feat', 'Power-up', 'A feature. The chapter\'s biggest ones drop as orbs; the rest make their author glow.'],
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
  if (meta && meta.savedAt && meta.repo) {
    note.append(`Built ${ago(meta.savedAt)} from ${fmtN(ep.summary.commits)} commits · `);
    const b = document.createElement('button'); b.className = 'link'; b.type = 'button'; b.textContent = 'Rebuild';
    b.addEventListener('click', () => openRepo(meta.repo, { force: true }));
    note.append(b);
    note.hidden = false;
  } else note.hidden = true;
  if (meta && meta.repo) $('#repoUrl').value = `github.com/${meta.repo.owner}/${meta.repo.repo}${meta.repo.branch ? '/tree/' + meta.repo.branch : ''}`;
}

// ================= building from GitHub =================
let building = null;
function showProgress(on, title) {
  $('#progressCard').hidden = !on;
  if (title) $('#pcTitle').textContent = title;
  $('#bBuild').disabled = on;
}
function setProgress(msg, frac) {
  $('#pcMsg').textContent = msg;
  const bar = $('#pcBar').parentElement;
  if (frac == null) { bar.classList.add('indeterminate'); $('#pcBar').style.width = ''; }
  else { bar.classList.remove('indeterminate'); $('#pcBar').style.width = Math.round(frac * 100) + '%'; }
}
function showError(msg) {
  const el = $('#errorBox');
  el.hidden = !msg; el.textContent = msg || '';
}
const repoKey = (r) => `${r.owner}/${r.repo}${r.branch ? '@' + r.branch : ''}`.toLowerCase();
const repoHash = (r) => `#/r/${r.owner}/${r.repo}${r.branch ? '/tree/' + encodeURIComponent(r.branch) : ''}`;

async function openRepo(r, { force = false } = {}) {
  showError('');
  const key = repoKey(r);
  const cached = !force && await cacheGet(key);
  if (cached) {
    try { showEpisode(cached.episode, { key, repo: r, savedAt: cached.savedAt, link: repoHash(r) }); return; } catch { /* older format or damaged: rebuild below */ }
  }
  if (building) building.abort();
  const ac = new AbortController(); building = ac;
  const token = getToken();
  const maxCommits = Number($('#commitLimit').value) || (token ? DEFAULT_LIMITS.withToken : DEFAULT_LIMITS.withoutToken);
  const limit = token ? maxCommits : Math.min(maxCommits, 3000);
  showProgress(true, `Building ${r.owner}/${r.repo}`);
  setProgress(token ? 'Connecting to GitHub with your token…' : 'Connecting to GitHub without a token (basic detail)…', null);
  try {
    const history = await fetchHistory({
      owner: r.owner, repo: r.repo, branch: r.branch, token, maxCommits: limit, signal: ac.signal,
      onProgress: (p) => setProgress(p.message, p.total ? Math.min(0.95, p.fetched / p.total) : null),
    });
    setProgress('Writing the story…', 0.97);
    await new Promise((res) => setTimeout(res, 30));
    const episode = buildEpisode(history);
    const savedAt = new Date().toISOString();
    await cacheSet(key, { savedAt, episode });
    showProgress(false);
    showEpisode(episode, { key, repo: r, savedAt, link: repoHash(r) });
    if (!EMBED) $('#stageWrap').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    if (history.source === 'github-rest' && !token) flash('Built without a token. Add one for linked issues and real enemy sizes.');
  } catch (e) {
    showProgress(false);
    if (e && e.name === 'AbortError') return;
    showError(e instanceof GitHubError || (e && e.message) ? e.message : 'Something went wrong while building the fight.');
    if (e instanceof GitHubError && (e.code === 'rate-limit' || e.code === 'not-found') && !token) $('#tokenBox').open = true;
  } finally {
    if (building === ac) building = null;
  }
}

async function openSample(name) {
  showError('');
  try {
    const res = await fetch(`./samples/${name}.json`);
    if (!res.ok) throw new Error(`The ${name} sample is missing from this build.`);
    showEpisode(await res.json(), { key: 'sample:' + name, link: `#/sample/${name}` });
    $('#repoUrl').value = '';
  } catch (e) { showError(e.message); }
}

function route() {
  const h = decodeURIComponent(location.hash || '');
  let m = h.match(/^#\/r\/([\w.-]+)\/([\w.-]+)(?:\/tree\/(.+))?$/);
  if (m) { openRepo({ owner: m[1], repo: m[2], branch: m[3] || null }); return; }
  m = h.match(/^#\/sample\/([\w-]+)$/);
  openSample(m ? m[1] : 'opencode');
}
window.addEventListener('hashchange', route);

$('#buildForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let r;
  try { r = parseRepoUrl($('#repoUrl').value); } catch (err) { showError(err.message); $('#repoUrl').focus(); return; }
  const hash = repoHash(r);
  if (location.hash === hash) openRepo(r, { force: true });
  else location.hash = hash;
});
$('#bCancel').addEventListener('click', () => { if (building) building.abort(); });
document.querySelectorAll('[data-repo]').forEach((b) => b.addEventListener('click', () => { $('#repoUrl').value = 'github.com/' + b.dataset.repo; $('#buildForm').requestSubmit(); }));
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => { location.hash = `#/sample/${b.dataset.sample}`; }));

// ================= token & options =================
function getToken() { return (storage.get('cw:token', 'local') || storage.get('cw:token', 'session') || '').trim(); }
function refreshTokenUI() {
  const t = getToken();
  $('#token').value = t;
  $('#rememberToken').checked = !!storage.get('cw:token', 'local');
  const pill = $('#tokenState'); pill.textContent = t ? 'set' : 'not set'; pill.classList.toggle('on', !!t);
}
$('#token').addEventListener('input', () => {
  const v = $('#token').value.trim();
  const where = $('#rememberToken').checked ? 'local' : 'session';
  storage.del('cw:token', 'local'); storage.del('cw:token', 'session');
  if (v) storage.set('cw:token', v, where);
  const pill = $('#tokenState'); pill.textContent = v ? 'set' : 'not set'; pill.classList.toggle('on', !!v);
});
$('#rememberToken').addEventListener('change', () => $('#token').dispatchEvent(new Event('input')));
$('#bForget').addEventListener('click', () => { storage.del('cw:token', 'local'); storage.del('cw:token', 'session'); refreshTokenUI(); });
const savedLimit = storage.get('cw:limit', 'local');
if (savedLimit && [...$('#commitLimit').options].some((o) => o.value === savedLimit)) $('#commitLimit').value = savedLimit;
$('#commitLimit').addEventListener('change', () => storage.set('cw:limit', $('#commitLimit').value, 'local'));

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
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // typing fields keep their keys; the timeline slider keeps its arrows; buttons and links keep Space and Enter
  const t = e.target.closest ? e.target : document.body;
  if (t.closest('input:not([type=range]), textarea, select')) return;
  if (t.closest('input[type=range]') && e.key.startsWith('Arrow')) return;
  if (t.closest('button, a, summary') && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ') { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? jumpChapter(1) : player.seekBy(7); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? jumpChapter(-1) : player.seekBy(-7); }
  else if (k === 'f') toggleFullscreen();
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
  showError(''); showEpisode(ep, { key: null, link: null });
  history.replaceState(null, '', baseUrl() + location.search);
  flash('Episode loaded from file.');
}));
$('#cmdText').textContent = GIT_LOG_COMMAND + ' > history.txt';
$('#bCopyCmd').addEventListener('click', () => copy($('#cmdText').textContent, 'Command'));
$('#logFile').addEventListener('change', (e) => readFile(e.target, (text, file) => {
  const base = file.name.replace(/\.(txt|log)$/i, '');
  const ep = buildEpisode(parseGitLog(text, { repoName: /^history$/i.test(base) ? 'your repo' : base }));
  showError(''); showEpisode(ep, { key: null, link: null });
  history.replaceState(null, '', baseUrl() + location.search);
  $('#stageWrap').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}));

// ================= boot =================
dropLegacyCache();
buildLegend();
refreshTokenUI();
route();
