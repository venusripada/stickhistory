// @commit-wars/player
// Plays a Commit Wars episode on a <canvas> as a movie of the repository's
// history: one calendar day takes the same screen time throughout, every
// fix is an enemy on the day it landed, and seek() jumps to any day. The
// player owns only the canvas; the page builds everything else (date,
// timeline, people, commit feed) from the episode and the `time` event.
//
//   const player = createPlayer({ canvas, episode });
//   player.on('time', ({ day, iso }) => …);
//   player.seek(120);  player.follow('octocat');
//
// Colors come from CSS custom properties on the canvas (see theme.js).

import { validateEpisode, secondsPerDay, isoOfDay, activeAt, chapterAt, fixOf, commitUrl } from '@commit-wars/story-engine';
import { DEFAULT_THEME, HERO_COLORS, readTheme } from './theme.js';
import { makeSim } from './sim.js';
import { makeDraw } from './draw.js';
import { buildEvents, firstEventAt, chooseLineup } from './director.js';
import { clamp, rand, fmtN, fmtDate, range, fixTag, fixKind, fixLabel, ETYPES, ENEMY_NAMES, H, GY } from './util.js';

export { DEFAULT_THEME, ENEMY_NAMES };
export const SPEEDS = [0.5, 1, 2, 4, 8];

/**
 * @typedef {'time'|'state'|'spotlight'|'loaded'} PlayerEvent
 *
 * time      { day, iso, days, chapter }          several times a second while playing, and on every seek
 * state     { playing, ended, speed, day, days, following }
 * spotlight { kind: 'duel'|'duel-won'|'boss'|'boss-down'|'release'|'chapter', … }  story beats, for captions
 * loaded    { episode }
 */

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas   Fills its parent when the parent has a height, else a 7:4 stage by width.
 * @param {object} [opts.episode]           A schemaVersion 2 episode. Can also be given later with load().
 * @param {boolean} [opts.autoplay=true]    Start playing when an episode loads (off under reduced motion).
 * @param {boolean} [opts.loop=false]       Start over a few seconds after the end.
 * @param {number} [opts.speed=1]           One of SPEEDS.
 * @param {boolean} [opts.clickToToggle=true]  Clicking the canvas pauses and resumes.
 * @param {(type: PlayerEvent, payload: any) => void} [opts.onEvent]
 */
export function createPlayer(opts) {
  const canvas = opts.canvas;
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('createPlayer needs a canvas element.');
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- events ----------
  const listeners = new Map();
  function emit(type, payload) {
    for (const fn of listeners.get(type) || []) { try { fn(payload); } catch (e) { console.error(e); } }
    if (opts.onEvent) { try { opts.onEvent(type, payload); } catch (e) { console.error(e); } }
  }

  // ---------- shared state ----------
  const C = readTheme(canvas, { hero: [] });
  const G = {};
  const CAM = { x: 350, z: 1, tx: 350, tz: 1 };
  let EP = null, TLN = null, events = [], cursor = 0, dayRate = 1, followWho = null;
  let colorIdx = new Map();
  const heroColor = (name) => C.hero[(colorIdx.get(name) ?? 0) % HERO_COLORS];
  const E = { ctx: canvas.getContext('2d'), C, G, CAM, W: 700, S: 1, DPR: 1, EP: null, inset: { l: 0, r: 0 }, reduceMotion, heroColor, say: (kind, p) => emit('spotlight', { kind, ...p }) };
  const sim = makeSim(E);
  const dr = makeDraw(E);

  function resetStage() {
    Object.assign(G, {
      time: G.time || 0, heroes: [], enemies: [], boss: null, finisher: null, bot: null, bolts: [], parts: [], fx: [], floaters: [], flags: [],
      duel: null, banner: null, stamp: null, cards: [], pending: [], bigQ: [], shake: 0, hitstop: 0, slowmo: 0, kills: 0, duelsWon: 0, bestCombo: 0,
      cheer: 0, fw: 0, fwT: 0, lineupT: 0, spawnT: 0, ended: false, endT: 0,
    });
    sim.camReset(); CAM.x = CAM.tx; CAM.z = CAM.tz;
  }
  Object.assign(G, { time: 0, day: 0, playing: !reduceMotion, speed: 1 });
  resetStage();

  // ---------- canvas size ----------
  function resize() {
    const par = canvas.parentElement;
    const cw = (par && par.clientWidth) || 700, ph = (par && par.clientHeight) || 0;
    const fill = ph > 80;
    E.S = fill ? ph / H : clamp(cw / 700, 0.7, 1.3);
    E.W = cw / E.S;
    E.DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * E.DPR);
    canvas.height = Math.round(H * E.S * E.DPR);
    canvas.style.height = (H * E.S) + 'px';
  }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  resizeObserver ? resizeObserver.observe(canvas.parentElement || canvas) : window.addEventListener('resize', resize);
  resize();
  const themeMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onTheme = () => readTheme(canvas, C);
  themeMQ && themeMQ.addEventListener('change', onTheme);
  const themeObserver = new MutationObserver(onTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

  // ---------- who is on stage ----------
  const onStage = (name) => G.heroes.find((h) => h.name === name && !h.leaving) || null;
  function freeSlot() { const used = new Set(G.heroes.filter((h) => !h.leaving).map((h) => h.k)); let k = 0; while (used.has(k)) k++; return k; }
  function addHero(name, placed) {
    const h = sim.makeHero(name, freeSlot());
    h.arrivedAt = G.time;
    if (placed) h.x = sim.homeX(h);
    G.heroes.push(h);
    return h;
  }
  const ensureHero = (name) => onStage(name) || addHero(name, false);
  /**
   * Put on stage the people who have something to fight (on stage, waiting, or due in
   * the next day and a half); see chooseLineup in director.js for the rules.
   */
  function lineup(placed) {
    const busy = new Map();
    const add = (name) => { if (name) busy.set(name, (busy.get(name) || 0) + 1); };
    for (const e of G.enemies) if (sim.alive(e)) add(e.author);
    for (const ev of G.pending) add(TLN.people[ev.who].name);
    for (let k = cursor; k < events.length && events[k].t < G.day + 1.5; k++) {
      const ev = events[k];
      if (ev.who != null && ['fix', 'duel', 'feat', 'featduel'].includes(ev.type)) add(TLN.people[ev.who].name);
    }
    const forced = [G.duel && G.duel.hero.name, G.finisher && G.finisher.hero && G.finisher.hero.name, G.boss && G.boss.info.who].filter(Boolean);
    const here = G.heroes.filter((h) => !h.leaving);
    const r = chooseLineup({
      busy, forced, max: E.W < 600 ? 4 : 6, now: G.time, minStay: placed ? 0 : 4,
      fill: activeAt(TLN, G.day, { window: 14, who: followWho, limit: 6 }).map((a) => a.name),
      onStage: here.map((h) => ({ name: h.name, arrivedAt: h.arrivedAt ?? 0, hasEnemy: G.enemies.some((e) => e.owner === h && sim.alive(e)) })),
    });
    for (const h of here) if (r.leave.includes(h.name)) { if (placed) h.gone = true; else { h.leaving = true; h.atk = null; h.state = 'idle'; } }
    G.heroes = G.heroes.filter((h) => !h.gone);
    for (const name of r.add) addHero(name, placed);
  }

  // ---------- story beats ----------
  function startDuel(ev) {
    const fx = fixOf(TLN, ev.i);
    const hero = ensureHero(fx.who);
    hero.state = 'idle'; hero.chain = null; hero.leaving = false;
    const e = sim.makeEnemy(fx, hero, 1, true);
    e.tx = E.W * .72;
    G.enemies.push(e);
    G.duel = { hero, fx, enemy: e, t: 0, combo: 0, comboT: 0, comboPop: 0, won: false };
    G.banner = { hero: hero.name, fx, t: 0 };
    E.say('duel', { hero: hero.name, fx, typeName: ETYPES[e.type].name, feature: e.type === 'feature' });
  }
  function startBoss(ev) {
    const fx = fixOf(TLN, ev.i);
    ensureHero(fx.who);
    G.boss = sim.makeBoss({ who: fx.who, s: fx.s, files: fx.files, d: fx.d, k: ev.k });
    E.say('boss', { who: fx.who, s: fx.s, files: fx.files, d: fx.d });
  }
  function handle(ev) {
    if (ev.type === 'chapter') {
      G.cards.push({ kind: 'chapter', k: ev.k, t: 0 });
      E.say('chapter', { k: ev.k, title: EP.chapters[ev.k].title });
    } else if (ev.type === 'release') {
      if (G.bot) { G.flags = G.flags.slice(-2); G.flags.push({ x: E.W * .4 + G.flags.length * 60, tag: ev.tag, t: 0 }); G.fw = 2; }
      else G.bot = { x: -50, state: 'enter', t: 0, carry: true, tag: ev.tag };
      G.cheer = 3;
      E.say('release', { tag: ev.tag, d: isoOfDay(TLN, ev.t) });
    } else if (ev.type === 'fix' || ev.type === 'feat') G.pending.push(ev);
    else if (ev.type === 'duel' || ev.type === 'featduel') { if (G.duel || G.boss) G.pending.push(ev); else startDuel(ev); }
    else if (ev.type === 'boss') { if (G.duel || G.boss) G.bigQ.push(ev); else startBoss(ev); }
    else if (ev.type === 'revert') {
      const fx = fixOf(TLN, ev.i);
      const h = onStage(fx.who) || G.heroes.find((x) => !x.leaving);
      if (h) sim.fireRevert(h, fx);
    }
  }

  // ---------- clock and update ----------
  let lastTimeKey = -1;
  function emitTime(force) {
    if (!TLN) return;
    const key = Math.floor(G.day * 8);
    if (!force && key === lastTimeKey) return;
    lastTimeKey = key;
    const k = chapterAt(EP, G.day);
    canvas.setAttribute('aria-label', `Stick-figure fight, ${fmtDate(isoOfDay(TLN, G.day))}: ${EP.chapters[k].title}.`);
    emit('time', { day: G.day, iso: isoOfDay(TLN, G.day), days: TLN.days, chapter: k });
  }
  const snapshot = () => ({ playing: G.playing, ended: G.ended, speed: G.speed, day: G.day, days: TLN ? TLN.days : 0, following: followWho == null ? null : TLN.people[followWho].name });
  function setPlaying(p) { G.playing = p; last = performance.now(); emit('state', snapshot()); }
  function end() {
    G.ended = true; G.cheer = 999; G.pending = [];
    G.cards = [{ kind: 'end', t: 0 }];
    emit('state', snapshot());
  }

  function update(dt) {
    G.time += dt;
    if (G.ended) {
      G.endT += dt;
      if (opts.loop && G.endT > 6) { seek(0); G.cards = [{ kind: 'intro', t: 0 }]; return; }
    } else {
      G.day = Math.min(TLN.days, G.day + dt * dayRate);
      while (cursor < events.length && events[cursor].t < G.day) handle(events[cursor++]);
      if (G.day >= TLN.days) end();
    }
    emitTime();
    if (G.hitstop > 0) { G.hitstop -= dt; G.shake = Math.max(0, G.shake - dt * 10); for (const f of G.fx) f.life -= dt * .3; return; }
    if (G.slowmo > 0) { G.slowmo -= dt; dt *= .3; }
    G.shake = Math.max(0, G.shake - dt * 24);

    // fixes queue up and enter a few at a time; ones left waiting three days are counted as squashed
    const stale = G.pending.findIndex((ev) => ev.t >= G.day - 3);
    if (stale !== 0) { const n = stale < 0 ? G.pending.length : stale; G.kills += n; G.pending.splice(0, n); }
    G.spawnT -= dt;
    const living = G.enemies.filter((e) => sim.alive(e) && !e.duel).length;
    if (!G.boss && !G.finisher && G.pending.length && living < (E.W < 600 ? 6 : 10) && G.spawnT <= 0) {
      const fx = fixOf(TLN, G.pending.shift().i);
      const side = Math.random() < .8 ? 1 : -1;
      const e = sim.makeEnemy(fx, onStage(fx.who), side, false);
      // walk well into the stage before engaging, so fights spread out instead of piling up at the edges
      e.tx = side > 0 ? rand(E.W * .4, E.W * .85) : rand(E.W * .15, E.W * .55);
      G.enemies.push(e);
      G.spawnT = rand(.12, .35);
    }
    const D = G.duel;
    if (D) {
      D.t += dt;
      if (G.banner) { G.banner.t += dt; if (G.banner.t > 2.2) G.banner = null; }
      if (D.comboT > 0) { D.comboT -= dt; if (D.comboT <= 0 && !D.won) D.combo = 0; }
      D.comboPop = Math.max(0, D.comboPop - dt);
      if (!D.won && D.t > 14 && sim.alive(D.enemy)) sim.finishEnemy(D.enemy, D.hero);
      if (D.won && D.t > 2.1) { G.duel = null; G.banner = null; sim.camReset(); }
      else if (!D.won) {
        // zoom in on a duel only when nothing else is fighting, so no brawl is cut off at the edges
        const brawl = G.boss || G.enemies.some((x) => !x.duel && sim.alive(x));
        if (brawl) sim.camReset(); else sim.camTarget((D.hero.x + D.enemy.x) / 2, E.W < 600 ? 1.1 : 1.15);
      }
    }
    if (!G.duel && !G.boss && !G.finisher && G.bigQ.length) { const ev = G.bigQ.shift(); if (ev.t > G.day - 10) startBoss(ev); }
    G.lineupT -= dt;
    if (G.lineupT <= 0) { lineup(false); G.lineupT = .6; }
    if (G.cards.length && !G.banner) { G.cards[0].t += dt; if (G.cards[0].t > 2.8 && G.cards[0].kind !== 'end') G.cards.shift(); }
    sim.step(dt);
  }

  // ---------- drawing ----------
  function drawCardFor(card) {
    const a = card.kind === 'end' ? clamp(card.t * 3, 0, 1) : clamp(Math.min(card.t * 4, (2.8 - card.t) * 3), 0, 1);
    const s = EP.summary;
    if (card.kind === 'intro') {
      dr.drawCard({ alpha: a, top: 92, rows: [
        { kind: 'eyebrow', text: 'git history replay' }, { kind: 'title', text: s.repo }, { kind: 'gap', h: 14 },
        { kind: 'mono', text: `${fmtN(s.commits)} commits · ${fmtN(s.humans)} authors · ${fmtN(s.fixes)} fix commits`, color: C.ink, weight: 600 },
        { kind: 'mono', text: `${fmtDate(TLN.start)} to ${fmtDate(TLN.end)}` } ] });
    } else if (card.kind === 'chapter') {
      const ch = EP.chapters[card.k];
      dr.drawCard({ alpha: a, top: 104, rows: [
        { kind: 'eyebrow', text: `Chapter ${card.k + 1} of ${EP.chapters.length} · ${range(ch.first, ch.last)}` }, { kind: 'title', text: ch.title }, { kind: 'gap', h: 10 },
        { kind: 'sub', text: ch.sub } ] });
    } else if (card.kind === 'end') {
      dr.drawCard({ alpha: a, top: 70, rows: [
        { kind: 'eyebrow', text: `Latest commit · ${fmtDate(s.latest.d)}` }, { kind: 'title', text: 'To be continued…' }, { kind: 'gap', h: 12 },
        { kind: 'mono', text: s.latest.s, color: C.ink, weight: 600 },
        { kind: 'mono', text: `by ${s.latest.who} · the fight is still going on the ${s.branch || 'main'} branch` } ] });
    }
  }
  function draw() {
    const ctx = E.ctx;
    dr.drawPaper();
    const sh = (G.shake && !reduceMotion) ? [rand(-G.shake, G.shake), rand(-G.shake, G.shake) * .6] : [0, 0];
    dr.worldTransform(sh[0], sh[1]);
    dr.drawGrid();
    dr.drawGround();
    for (const f of G.flags) dr.drawFlag(f);
    if (G.boss) dr.drawBoss(G.boss);
    dr.resetLabels();
    // newest enemies first, so fresh arrivals get their label when the crowd is thick
    for (let k = G.enemies.length - 1; k >= 0; k--) dr.drawEnemy(G.enemies[k]);
    if (G.bot) dr.drawBot(G.bot);
    for (const h of G.heroes) dr.drawFigure(h);
    dr.drawBeam();
    for (const x of G.bolts) dr.drawBolt(x);
    dr.drawFx();
    dr.drawParts();
    dr.screenTransform();
    if (G.hitstop > .12) { ctx.globalAlpha = .12; ctx.fillStyle = C.orb; ctx.fillRect(0, 0, E.W, H); ctx.globalAlpha = 1; }
    dr.drawBossBar();
    if (G.duel) dr.drawDuelHud();
    dr.drawStamp();
    dr.drawSwarm(G.pending.length);
    // a duel's banner takes the middle of the screen; the chapter card waits until it slides away
    if (G.cards.length && !G.banner) drawCardFor(G.cards[0]);
    if (!G.playing && !G.ended) {
      ctx.fillStyle = C.ink; ctx.globalAlpha = .82;
      ctx.beginPath(); ctx.arc(E.W - 34, H - 34, 20, 0, 7); ctx.fill();
      ctx.fillStyle = C.paper; ctx.beginPath(); ctx.moveTo(E.W - 40, H - 45); ctx.lineTo(E.W - 24, H - 34); ctx.lineTo(E.W - 40, H - 23); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- loop ----------
  let last = performance.now();
  let rafId = 0, destroyed = false;
  function frame(now) {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (EP && G.playing) {
      let total = dt * G.speed;
      while (total > 0) { const st = Math.min(total, 1 / 60); update(st); total -= st; }
    }
    if (EP) draw();
    rafId = requestAnimationFrame(frame);
  }
  const onVisibility = () => { last = performance.now(); };
  document.addEventListener('visibilitychange', onVisibility);

  // ---------- seeking ----------
  /** Jump to a (fractional) day. The stage is rebuilt for that day; nothing in between is replayed. */
  function seek(day) {
    if (!TLN) return;
    resetStage();
    G.day = clamp(day, 0, TLN.days - 0.001);
    cursor = firstEventAt(events, G.day);
    lineup(true);
    const rel = TLN.releases.filter((r) => r.weight >= 2 && r.day <= G.day).pop();
    if (rel) G.flags.push({ x: E.W * .55 + 16, tag: rel.tag, t: 0 });
    const k = chapterAt(EP, G.day);
    G.cards = [{ kind: 'chapter', k, t: 0 }];
    E.say('chapter', { k, title: EP.chapters[k].title });
    emitTime(true);
    emit('state', snapshot());
  }
  function toggle() {
    if (!EP) return;
    if (G.ended) { seek(0); setPlaying(true); return; }
    setPlaying(!G.playing);
  }
  const onCanvasClick = () => toggle();
  if (opts.clickToToggle !== false) canvas.addEventListener('click', onCanvasClick);

  const api = {
    /** Load (or replace) the episode and start from the first day. Throws a readable error for unplayable episodes. */
    load(episode) {
      const errs = validateEpisode(episode);
      if (errs.length) throw new Error(errs[0]);
      EP = episode; E.EP = episode; TLN = episode.timeline;
      colorIdx = new Map(TLN.people.map((p, i) => [p.name, i]));
      dayRate = 1 / secondsPerDay(TLN);
      followWho = null;
      events = buildEvents(EP);
      emit('loaded', { episode });
      seek(0);
      G.cards = [{ kind: 'intro', t: 0 }];
      setPlaying(opts.autoplay !== false && !reduceMotion);
      return api;
    },
    play() { if (EP) { if (G.ended) seek(0); setPlaying(true); } },
    pause() { if (EP) setPlaying(false); },
    toggle,
    seek,
    /** Move by a number of days (negative goes back). */
    seekBy(days) { if (TLN) seek(G.day + days); },
    /** Follow one person: only their fixes and features play, and only they fight. Null shows everyone. */
    follow(name) {
      if (!EP) return false;
      const i = name == null ? -1 : TLN.people.findIndex((p) => p.name === name);
      if (name != null && i < 0) return false;
      followWho = i < 0 ? null : i;
      events = buildEvents(EP, { who: followWho });
      seek(G.day);
      return true;
    },
    /** CSS pixels covered by page overlays at the left and right; cards and bars centre between them. */
    setInsets(left = 0, right = 0) { E.inset.l = Math.max(0, left) / E.S; E.inset.r = Math.max(0, right) / E.S; },
    setSpeed(n) { G.speed = SPEEDS.includes(n) ? n : 1; emit('state', snapshot()); },
    get speed() { return G.speed; },
    get day() { return G.day; },
    get following() { return followWho == null ? null : TLN.people[followWho].name; },
    getState: snapshot,
    /** Where everyone is on stage, in world units (for tests and debugging). */
    stageSnapshot() {
      return {
        width: E.W, zoom: CAM.z,
        heroes: G.heroes.map((h) => ({ name: h.name, x: h.x, leaving: h.leaving, entered: !!h.entered })),
        enemies: G.enemies.map((e) => ({ x: e.x, r: e.r, state: e.state, duel: !!e.duel, entered: !!e.entered, type: e.type, author: e.author })),
      };
    },
    get episode() { return EP; },
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type).delete(fn); },
    /** The resolved color for a person, matching the canvas. */
    colorOf(name) { return heroColor(name); },
    /** CSS custom property for a person ("var(--c3)"), so host UI follows theme changes. */
    colorVarOf(name) { return `var(--c${((colorIdx.get(name) ?? 0) % HERO_COLORS) + 1})`; },
    /** Draw one enemy of a type onto a small canvas (legends, cards). */
    drawEnemyIcon(target, type) {
      const c2 = target.getContext('2d');
      const w = target.width, h = target.height, k = w / 80;
      c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, w, h);
      const d2 = makeDraw({ ...E, ctx: c2, W: 80, inset: { l: 0, r: 0 } });
      const e = sim.makeEnemy({ type, files: 6, sha: '0000000', t: '', d: '', issues: [] }, null, 1, true);
      e.x = 40; e.f = 1; e.state = 'move'; e.s = 0.92; e.r = 20; e.phase = 1;
      c2.setTransform(k, 0, 0, k, 0, (h * 0.95 - GY * k) + ETYPES[type].hover * 0.55 * k);
      d2.drawEnemy(e);
    },
    enemyTypeName(type) { return (ETYPES[type] || ETYPES.crawler).name; },
    fixTag, fixKind,
    /** A fix in words: "tui · cursor jumps", "#51 crash on start" (see util.js). */
    fixLabel,
    /** Link to the issue, pull request or commit behind a fix record. */
    fixUrl(fx) { return commitUrl(EP && EP.summary.repoUrl, fx); },
    redraw() { readTheme(canvas, C); resize(); },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      resizeObserver ? resizeObserver.disconnect() : window.removeEventListener('resize', resize);
      themeMQ && themeMQ.removeEventListener('change', onTheme);
      themeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('click', onCanvasClick);
      listeners.clear();
    },
  };

  if (opts.speed) G.speed = SPEEDS.includes(opts.speed) ? opts.speed : 1;
  rafId = requestAnimationFrame(frame);
  if (opts.episode) api.load(opts.episode);
  return api;
}
