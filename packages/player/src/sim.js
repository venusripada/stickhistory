// The fight itself: heroes, enemies (bugs and unfinished features), the Tech Debt boss,
// revert bolts and particle effects. Everything lives in E.G; the player
// decides who enters and when, this module makes them move and hit.

import { POSES, MOVES, CHAINS, zeroPose, springPose, figurePoints } from './poses.js';
import { clamp, lerp, rand, pick, fmtN, trunc, fixLabel, filesLabel, ETYPES, GY } from './util.js';
import { makeEffects } from './effects.js';
import { slotFor, inReach, depthToward } from './floor.js';

/**
 * @param {object} E  Shared player state: { G, C, CAM, W, reduceMotion, heroColor(name), say(kind, payload) }.
 */
export function makeSim(E) {
  const { G, C, CAM } = E;
  const col = (name) => E.heroColor(name);

  // ---------- camera ----------
  function camTarget(x, z) { CAM.tz = z; const half = E.W / (2 * z); CAM.tx = clamp(x, half, E.W - half); }
  function camReset() { camTarget(E.W / 2, 1); }

  // effects remember the depth they happen at (G.curD, set by whoever is acting)
  const { burst, dust, scraps, impact, ring, floater, firework } = makeEffects(E);

  // ---------- enemies ----------
  /** fx: a fix record (see fixOf). author: the person who made the fix. */
  function makeEnemy(fx, owner, side, duel) {
    const files = Math.max(1, fx.files || 1);
    const s = duel ? 1.05 + Math.min(files, 60) / 60 * 0.75 : 0.82 + Math.min(files, 30) / 30 * 0.35;
    const need = duel ? clamp(Math.round(3 + Math.log2(files + 1) * 1.3), 4, 11) : (files > 8 ? 2 : 1);
    // a feature commit is unfinished work to build; a fix commit is a bug to squash
    const type = fx.kind === 'feat' ? 'feature' : fx.type in ETYPES ? fx.type : 'crawler';
    const T = ETYPES[type];
    return { kind: 'enemy', type, T, fx, owner, author: fx.who || null, duel, s, r: 22 * s,
             x: side > 0 ? E.W + 50 : -50, f: side > 0 ? -1 : 1, z: 0, vz: 0, kx: 0, hp: need, need,
             state: 'enter', timer: 0, cd: rand(1.2, 2.0), phase: Math.random() * 6, flash: 0, sq: 0, sqv: 0,
             tx: null, d: 0.5, td: null, seed: Math.random() * 100, alpha: 1, rot: 0 };
  }
  const alive = (e) => e.state !== 'dead';
  const fighting = (h) => !h.leaving;
  function nearestHero(e) {
    if (e.duel && G.duel) return G.duel.hero;
    // an enemy goes for its own author when they're on stage, so each fight stays on its own patch
    if (e.owner && fighting(e.owner) && G.heroes.includes(e.owner) && !(G.duel && e.owner === G.duel.hero)) return e.owner;
    let best = null, bd = 1e9;
    for (const h of G.heroes) {
      if (!fighting(h) || (G.duel && h === G.duel.hero)) continue;
      const d = Math.abs(h.x - e.x) + Math.abs(h.d - e.d) * 300 + (h.state === 'down' ? 80 : 0) + (e.owner && e.owner !== h ? 60 : 0);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function updEnemy(e, dt) {
    G.curD = e.d;
    e.phase += dt * (e.state === 'enter' || e.state === 'move' ? 14 : 5);
    e.flash = Math.max(0, e.flash - dt);
    const sqa = -260 * e.sq - 16 * e.sqv; e.sqv += sqa * dt; e.sq += e.sqv * dt;
    e.x += e.kx * dt; e.kx *= Math.exp(-6 * dt);
    if (e.z > 0 || e.vz !== 0) {
      e.vz -= 1100 * dt; e.z += e.vz * dt;
      if (e.z <= 0) {
        e.z = 0;
        if (e.vz < -280 && e.state !== 'dead') { e.vz = -e.vz * .32; e.sqv -= 6; dust(e.x, 10); G.shake = Math.max(G.shake, 3); }
        else { e.vz = 0; if (e.state === 'air') { e.state = 'down'; e.timer = .45; } }
      }
    }
    // once fully on screen, a living enemy stays on screen (knockback included)
    if (!e.entered && e.x - e.r >= 0 && e.x + e.r <= E.W) e.entered = true;
    if (e.entered && e.state !== 'dead') e.x = clamp(e.x, e.r + 4, E.W - e.r - 4);
    else e.x = clamp(e.x, -80, E.W + 80);
    if (e.state === 'dead') { e.timer -= dt; e.alpha = clamp(e.timer / .7, 0, 1); e.rot += dt * 6 * e.f; return; }
    if (e.state === 'hurt') { e.timer -= dt; if (e.timer <= 0) e.state = 'move'; return; }
    if (e.state === 'air') return;
    if (e.state === 'down') { e.timer -= dt; if (e.timer <= 0) { e.state = 'move'; e.vz = 160; } return; }
    if (e.state === 'stagger') { e.timer -= dt; if (e.timer <= 0) e.state = 'move'; return; }
    const h = nearestHero(e); if (!h) return;
    const dx = h.x - e.x;
    if (e.state === 'enter') {
      const tx = e.tx != null ? e.tx : h.x;
      const ddx = tx - e.x;
      e.f = ddx >= 0 ? 1 : -1;
      e.x += e.f * Math.min(Math.abs(ddx), e.T.speed * 1.6 * dt);
      e.d = depthToward(e.d, e.td ?? h.d, 0.6 * dt);
      if (Math.abs(ddx) < 6 || (e.tx == null && Math.abs(dx) < 90)) { e.state = 'move'; e.f = dx >= 0 ? 1 : -1; }
      return;
    }
    e.f = dx >= 0 ? 1 : -1;
    if (e.state === 'tele') {
      e.timer -= dt; e.kx -= e.f * 40 * dt * 10;
      if (e.timer <= 0) { e.state = 'lunge'; e.timer = .22; e.kx = e.f * (e.type === 'beetle' ? 420 : 300); if (!e.T.hover) e.vz = e.type === 'gremlin' ? 260 : 120; }
      return;
    }
    if (e.state === 'lunge') {
      e.timer -= dt;
      if (e.timer <= 0) { e.state = 'move'; if (inReach(h, e, e.r + 34)) enemyHits(e, h); }
      return;
    }
    const keep = e.r + 26;
    if (Math.abs(dx) > keep + 6) e.x += e.f * e.T.speed * dt;
    else if (Math.abs(dx) < keep - 14) e.x -= e.f * 30 * dt;
    e.d = depthToward(e.d, h.d, 0.5 * dt);
    e.cd -= dt;
    if (e.cd <= 0 && Math.abs(dx) < keep + 40 && Math.abs(h.d - e.d) < 0.14 && h.state !== 'down') {
      e.state = 'tele'; e.timer = e.duel ? .5 : .38; e.cd = e.duel ? rand(1.5, 2.4) : rand(1.6, 2.6);
      const r = Math.random();
      h.react = r < .5 ? 'dodge' : r < .78 ? 'parry' : 'take';
      h.threat = e;
    }
  }
  function enemyHits(e, h) {
    G.curD = h.d;
    if (h.state === 'down' || h.state === 'dodge') return;
    if (h.react === 'parry' && h.state !== 'attack') {
      h.state = 'parry'; h.timer = .3; h.atk = null;
      e.state = 'stagger'; e.timer = .55; e.kx = -e.f * 260; e.sqv += 5;
      impact((h.x + e.x) / 2, GY - 60 - e.T.hover * .5, C.orb, 18, 'spark');
      floater(h.x, GY - 125, 'parry!', col(h.name), 20);
      G.hitstop = Math.max(G.hitstop, .07);
      return;
    }
    h.atk = null;
    const heavy = e.type === 'beetle' || e.type === 'bomb';
    if (heavy && Math.random() < .5) { h.state = 'down'; h.timer = .9; } else { h.state = 'hurt'; h.timer = .38; }
    h.kx = e.f * (heavy ? 320 : 220);
    impact(h.x, GY - 62, C.bug, 14, 'hit');
    if (e.type === 'bomb') { ring(e.x, GY - 20, C.bug); burst(e.x, GY - 30, C.orb, 12, 180); }
    floater(h.x, GY - 125, pick(['ouch', 'oof', 'bzzt', 'ugh']), C.bug, 18);
    G.shake = Math.max(G.shake, heavy ? 7 : 4);
    G.hitstop = Math.max(G.hitstop, .05);
    if (G.duel && h === G.duel.hero) G.duel.combo = 0;
  }

  // ---------- heroes ----------
  function makeHero(name, k) {
    return { kind: 'hero', name, k, x: -40 - k * 30, d: slotFor(k, E.W).d, z: 0, vz: 0, kx: 0, f: 1,
             state: 'idle', timer: 0, cool: rand(0, .3), pose: Object.assign({}, POSES.idle), pv: zeroPose(),
             atk: null, chain: null, ci: 0, aura: 0, walkT: Math.random(), seed: k * 101 + 7,
             trail: [], trailT: 0, react: null, threat: null, leaving: false };
  }
  /** Each hero's own patch of floor (floor.js). */
  const home = (h) => slotFor(h.k, E.W);
  const enemyReach = (t) => (t.kind === 'boss' ? t.r + 110 : t.r + 22);
  function nearestTarget(h) {
    if (G.duel && G.duel.hero === h) return G.duel.enemy && alive(G.duel.enemy) ? G.duel.enemy : null;
    if (G.boss && (G.boss.state === 'fight' || G.boss.state === 'wind')) return G.boss;
    // your own bugs and features first; help with others' only when you have none
    let best = null, bd = 1e9, mine = false;
    for (const e of G.enemies) {
      if (!alive(e) || e.duel || e.x < -10 || e.x > E.W + 10) continue;
      const own = e.owner === h;
      // someone else's enemy: only once its owner has struck first (or isn't here to)
      if (!own && e.owner && !e.owner.leaving && G.heroes.includes(e.owner) && !e.ownerHit) continue;
      if (mine && !own) continue;
      const d = Math.abs(e.x - h.x) + Math.abs(e.d - h.d) * 300;
      if ((own && !mine) || d < bd) { bd = d; best = e; mine = own; }
    }
    return best;
  }
  function walkPose(h, dt, fast) { h.walkT += dt * (fast ? 9 : 6.5); const a = Math.floor(h.walkT) % 2; return fast ? (a ? 'dash1' : 'dash2') : (a ? 'walk1' : 'walk2'); }
  /** Walk toward x (and depth td when given); true once there. */
  function moveTo(h, tx, dt, speed = 120, td = null) {
    if (td != null) h.d = depthToward(h.d, td, 0.55 * dt);
    const dx = tx - h.x;
    if (Math.abs(dx) < 4) return td == null || Math.abs(h.d - td) < 0.01;
    h.f = dx > 0 ? 1 : -1;
    const B = G.boss;
    if (B && h.z === 0 && h.vz === 0 && (B.x - h.x) * (tx - B.x) > 0 && Math.abs(B.x - h.x) < B.r + 50) h.vz = 440;
    if (h.z > 0) speed *= 2.2;
    h.x += h.f * Math.min(Math.abs(dx), speed * dt);
    if (speed > 200 && Math.random() < dt * 14) dust(h.x - h.f * 8, 4);
    return false;
  }
  function startMove(h, t, m) {
    if (m === 'air' && !(t.kind === 'enemy' && t.z > 30)) m = 'kick';
    h.state = 'attack'; h.atk = { m, M: MOVES[m], t: 0, hit: false, target: t, jumped: false };
  }
  function attackPose(h, dt) {
    const a = h.atk, M = a.M; a.t += dt;
    const t = a.target;
    if (M.rush && a.t < M.tw) { h.x += h.f * M.rush * dt; if (Math.random() < dt * 20) dust(h.x - h.f * 10, 4); }
    if (M.jump && a.t >= M.tw && !a.jumped) {
      a.jumped = true;
      if (a.m === 'air') { h.vz = 470; h.kx += h.f * Math.min(260, Math.abs((t ? t.x : h.x) - h.x) * 2.2); }
      else { h.vz = 300; h.kx += h.f * 150; }
      dust(h.x, 6);
    }
    if (a.t >= M.th && !a.hit) { a.hit = true; tryHit(h, t, M, a.m); }
    if (a.t >= M.tr && (a.m !== 'air' || h.z === 0)) { h.state = 'idle'; h.atk = null; h.cool = rand(.04, .12); return 'bounce'; }
    if (a.m === 'air') return a.t < M.tw ? 'crouch' : (a.hit ? 'tuck' : (a.t < M.th - .12 ? 'tuck' : 'slam'));
    return a.t < M.tw ? M.wind : M.strike;
  }
  function strikePoint(h, m) {
    const p = figurePoints(E, h.pose, h.x, h.z, h.f, h.seed, false);
    return ['kick', 'hikick', 'sweep', 'fly'].includes(m) ? p.fA : (m === 'smash' ? p.hB : p.hA);
  }
  function tryHit(h, t, M, m) {
    if (!t) return;
    G.curD = t.kind === 'enemy' ? (h.d + t.d) / 2 : h.d;
    const sp = strikePoint(h, m);
    const power = h.aura > 0 ? 1.4 : 1;
    if (t.kind === 'enemy') {
      if (!alive(t) || Math.abs(t.x - h.x) > enemyReach(t) + M.reach - 4 || Math.abs(t.d - h.d) > 0.16) { if (t.duel) floater(h.x + h.f * 30, GY - 90, 'whiff', C.muted, 14); return; }
      h.fought = true;
      if (t.owner === h) t.ownerHit = true;
      t.hp -= M.dmg * power; t.flash = .1; t.sqv += M.squash ? 9 : 5;
      t.kx = h.f * M.kb;
      const ix = (sp.x + t.x) / 2, iy = Math.min(sp.y, GY - t.z - t.T.hover - 20 * t.s);
      const heavy = M.dmg >= 1.5 || M.launch || M.spike;
      impact(ix, iy, col(h.name), heavy ? 26 : 16, heavy ? 'big' : 'hit');
      G.hitstop = Math.max(G.hitstop, heavy ? .09 : .045);
      G.shake = Math.max(G.shake, heavy ? 6 : 2.5);
      if (G.duel && h === G.duel.hero && t.duel) {
        G.duel.combo++; G.duel.comboT = 1.4; G.bestCombo = Math.max(G.bestCombo, G.duel.combo);
        if (G.duel.combo >= 3) G.duel.comboPop = .25;
      }
      if (t.hp <= 0) { finishEnemy(t, h); return; }
      if (M.launch && t.T.launch) { t.state = 'air'; t.vz = M.launch; floater(t.x, GY - 120, 'launch!', col(h.name), 18); }
      else if (M.spike && t.z > 10) { t.state = 'air'; t.vz = -620; }
      else if (M.pop && t.T.launch) { t.state = 'air'; t.vz = M.pop; }
      else { t.state = 'hurt'; t.timer = .22; }
      if (t.z > 20 && !M.spike) t.vz = Math.max(t.vz, 180);
    } else if (t.kind === 'boss') {
      if (Math.abs(t.x - h.x) > enemyReach(t) + 30 || (t.state !== 'fight' && t.state !== 'wind')) return;
      h.fought = true;
      t.hp = Math.max(19, t.hp - M.dmg * power * rand(2.2, 3.4)); t.flash = .1; t.kx = h.f * 30;
      impact(t.x - Math.sign(t.x - h.x) * t.r * .8, GY - rand(30, 80), col(h.name), 16, 'hit');
      G.hitstop = Math.max(G.hitstop, .04);
      if (t.hp <= 20 && !G.finisher) startFinisher();
    }
  }
  function finishEnemy(e, h) {
    e.state = 'dead'; e.timer = .8; e.kx = (h ? h.f : 1) * 340; e.vz = 380;
    const c = h ? col(h.name) : C.ink;
    G.kills++;
    if (e.duel) {
      G.hitstop = .26; G.slowmo = .7; G.shake = 12;
      impact(e.x, GY - 40 - e.T.hover, c, 46, 'big'); ring(e.x, GY - 40, c); ring(e.x, GY - 40, C.orb, 1.4);
      burst(e.x, GY - 40, C.bug, 26, 260); scraps(e.x, GY - 50, e.fx.files);
      G.stamp = { text: e.type === 'feature' ? 'SHIPPED' : 'FIXED', sub: [fixLabel(e.fx, 32), filesLabel(e.fx.files)].filter(Boolean).join(' · '), col: c, t: 0 };
      G.duelsWon++;
      if (G.duel) { G.duel.won = true; G.duel.t = 0; }
      E.say('duel-won', { hero: h ? h.name : null, fx: e.fx, combo: G.duel ? G.duel.combo : 0 });
    } else {
      const feature = e.type === 'feature';
      impact(e.x, GY - 28 - e.T.hover, c, 22, 'big'); burst(e.x, GY - 22, feature ? C.orb : C.bug, 14, 170);
      G.hitstop = Math.max(G.hitstop, .05);
      if (Math.random() < .5) floater(e.x, GY - 80, pick(feature ? ['shipped!', 'built!', 'done!', 'landed!'] : ['fixed!', 'squashed!', 'patched!', 'merged!']), feature ? C.gold : C.bug, 20);
    }
  }
  /** Too much work for the stage at once: the hero finishes one in passing with a quick strike. */
  function finishInPassing(h, feature) {
    G.curD = h.d;
    if (h.state === 'idle' || h.state === 'stance' || h.state === 'victory') { h.state = 'attack'; h.atk = { m: 'jab', M: MOVES.jab, t: 0, hit: true, target: null, jumped: false }; }
    impact(h.x + h.f * 28, GY - 60 - h.z, feature ? C.orb : C.bug, 14, 'spark');
    floater(h.x, GY - 110, feature ? pick(['shipped!', 'done!']) : pick(['squashed!', 'fixed!']), feature ? C.gold : C.bug, 16);
  }
  function heroThink(h, dt) {
    if (h.threat && h.threat.state === 'tele' && h.threat.timer < .2 && h.state !== 'attack') {
      const e = h.threat; h.threat = null;
      if (h.react === 'dodge') {
        h.state = 'dodge'; h.timer = .32; h.f = e.x >= h.x ? 1 : -1;
        h.kx = -h.f * 330; h.vz = 170; dust(h.x, 6);
        return 'backstep';
      }
      if (h.react === 'parry') { h.f = e.x >= h.x ? 1 : -1; return 'block'; }
    }
    if (h.leaving) { moveTo(h, -90, dt, 150); return walkPose(h, dt); }
    if (G.duel && G.duel.hero === h) return duelThink(h, dt);
    if (G.finisher) {
      if (h === G.finisher.hero) {
        if (G.finisher.phase === 'approach') {
          const tx = (G.boss ? G.boss.x : E.W * .75) - 200;
          if (moveTo(h, tx, dt, 150, G.boss ? G.boss.d : 0.5)) { h.f = 1; h.state = 'cast'; G.finisher.phase = 'cast'; G.finisher.t = 0; return 'cast'; }
          return walkPose(h, dt);
        }
        h.f = 1; return G.finisher.phase === 'done' ? 'cheer' : 'cast';
      }
      if (moveTo(h, Math.min(home(h).x, E.W * .3), dt, 120, home(h).d)) { h.f = 1; return G.finisher.phase === 'done' ? 'cheer' : 'stance'; }
      return walkPose(h, dt);
    }
    const t = nearestTarget(h);
    if (t && t.kind === 'boss') {
      const side = h.k % 2 === 0 ? -1 : 1;
      const slot = clamp(t.x + side * (t.r + 12 + Math.floor(h.k / 2) * 30 + (side < 0 ? 22 : 0)), 20, E.W - 22);
      // spread around the boss in depth too
      if (!moveTo(h, slot, dt, 150, 0.15 + (h.k % 3) * 0.3)) return walkPose(h, dt);
      h.f = t.x >= h.x ? 1 : -1;
      return comboStep(h, t, dt);
    }
    if (!t) {
      if (moveTo(h, home(h).x, dt, 120, home(h).d)) { h.f = 1; return G.cheer > 0 ? (Math.sin(G.time * 4 + h.k * 1.7) > 0 ? 'victory' : 'cheer') : 'stance'; }
      return walkPose(h, dt);
    }
    const dx = t.x - h.x; h.f = dx >= 0 ? 1 : -1;
    if (!inReach(h, t, enemyReach(t) + 8, 0.1)) {
      const far = Math.abs(dx) > 160;
      if (Math.abs(dx) > enemyReach(t) + 8) h.x += h.f * (far ? 230 : 130) * dt;
      h.d = depthToward(h.d, t.d, 0.6 * dt);
      return walkPose(h, dt, far);
    }
    return comboStep(h, t, dt);
  }
  function comboStep(h, t, dt) {
    h.cool -= dt;
    if (h.cool > 0) return 'bounce';
    if (!h.chain || h.ci >= h.chain.length) { h.chain = pick(CHAINS); h.ci = 0; if (Math.random() < .5) { h.cool = rand(.2, .45); return 'stance'; } }
    startMove(h, t, h.chain[h.ci++]);
    return MOVES[h.atk.m].wind;
  }
  function duelThink(h, dt) {
    const D = G.duel;
    if (D.won) { if (h.z === 0 && D.t > .5 && D.t < .6) h.vz = 260; return D.t > .4 ? 'victory' : 'bounce'; }
    const e = D.enemy;
    if (!e || !alive(e)) return 'stance';
    const dx = e.x - h.x; h.f = dx >= 0 ? 1 : -1;
    h.d = depthToward(h.d, e.d, 0.6 * dt);
    if (Math.abs(dx) > enemyReach(e) + 10) {
      const far = Math.abs(dx) > 150;
      h.x += h.f * (far ? 260 : 130) * dt;
      if (far && Math.random() < dt * 14) dust(h.x - h.f * 10, 4);
      return walkPose(h, dt, far);
    }
    if (e.state === 'air' && e.z > 30 && h.chain && h.chain[h.ci] !== 'air') { startMove(h, e, 'air'); return 'crouch'; }
    return comboStep(h, e, dt);
  }
  function updHero(h, dt) {
    G.curD = h.d;
    if (h.z > 0 || h.vz > 0) {
      h.vz -= 1050 * dt; h.z += h.vz * dt;
      if (h.z <= 0) { h.z = 0; if (h.vz < -300) dust(h.x, 8); h.vz = 0; }
    }
    h.x += h.kx * dt; h.kx *= Math.exp(-6 * dt);
    h.x = clamp(h.x, -220, E.W + 60);
    h.aura = Math.max(0, h.aura - dt);
    h.timer -= dt;
    let target = 'stance', k = 380;
    switch (h.state) {
      case 'down': target = 'down'; k = 160; if (h.timer <= 0) { h.state = 'getup'; h.timer = .35; } break;
      case 'getup': target = 'crouch'; k = 220; if (h.timer <= 0) h.state = 'idle'; break;
      case 'hurt': target = 'hurt'; k = 520; if (h.timer <= 0) h.state = 'idle'; break;
      case 'dodge': target = 'backstep'; k = 520; if (h.timer <= 0) { h.state = 'idle'; h.cool = .05; } break;
      case 'parry': target = 'parry'; k = 600; if (h.timer <= 0) h.state = 'idle'; break;
      case 'attack': target = attackPose(h, dt); k = 640; break;
      case 'cast': target = heroThink(h, dt); k = 300; break;
      default: target = heroThink(h, dt);
    }
    springPose(h, POSES[target] || POSES.stance, k, dt);
    h.trailT -= dt;
    const fast = h.state === 'attack' || h.state === 'dodge' || Math.abs(h.kx) > 200;
    if (fast && h.trailT <= 0 && !E.reduceMotion) { h.trailT = .035; h.trail.push({ pts: figurePoints(E, h.pose, h.x, h.z, h.f, h.seed, false), life: .16 }); }
    for (const t of h.trail) t.life -= dt;
    h.trail = h.trail.filter((t) => t.life > 0);
  }

  // ---------- boss ----------
  function makeBoss(info) { return { kind: 'boss', info, d: 0.3, x: E.W + 140, f: -1, r: 72, hp: 100, state: 'enter', timer: 0, cd: 2, phase: 0, flash: 0, kx: 0, claw: 0, age: 0 }; }
  function updBoss(B, dt) {
    G.curD = B.d;
    B.phase += dt * 6; B.flash = Math.max(0, B.flash - dt); B.age += dt;
    B.x += B.kx * dt; B.kx *= Math.exp(-5 * dt);
    if (B.age > 16 && !G.finisher && B.state !== 'dying') { B.hp = 20; startFinisher(); }
    if (B.state === 'enter') { B.x -= 110 * dt; if (B.x <= Math.min(E.W * 0.75, E.W - B.r - 66)) { B.state = 'fight'; G.shake = 8; dust(B.x - 30, 14); dust(B.x + 30, 14); } return; }
    if (B.state === 'fight') { B.claw = lerp(B.claw, 0, dt * 8); B.cd -= dt; if (B.cd <= 0) { B.state = 'wind'; B.timer = .6; } return; }
    if (B.state === 'wind') {
      B.claw = lerp(B.claw, 1, dt * 10); B.timer -= dt;
      if (B.timer <= 0) {
        B.state = 'fight'; B.cd = rand(2, 2.8); B.claw = -0.6; G.shake = 8;
        ring(B.x - B.r, GY - 20, C.bug); dust(B.x - B.r - 30, 12);
        for (const h of G.heroes) {
          if (h.x > B.x - B.r - 110 && h.x < B.x + B.r + 60 && h.z < 40 && h.state !== 'down') {
            if (Math.random() < .35) { h.state = 'dodge'; h.timer = .35; h.vz = 300; h.kx = (h.x < B.x ? -1 : 1) * 200; continue; }
            h.atk = null;
            if (Math.random() < .35) { h.state = 'down'; h.timer = 1.0; } else { h.state = 'hurt'; h.timer = .45; }
            h.kx = h.x < B.x ? -300 : 240;
            impact(h.x, GY - 60, C.bug, 14, 'hit');
          }
        }
        G.hitstop = .08;
        floater(B.x - B.r, GY - 140, 'BONK', C.ink, 26);
      }
      return;
    }
    if (B.state === 'stagger') { B.claw = lerp(B.claw, -.3, dt * 4); return; }
    if (B.state === 'dying') {
      B.timer -= dt; B.flash = .1; G.shake = 5;
      if (Math.random() < dt * 30) burst(B.x + rand(-60, 60), GY - rand(20, 90), pick([C.bug, C.orb, C.ink]), 6, 140);
      if (B.timer <= 0) {
        const c = col(G.finisher.hero.name);
        for (let k = 0; k < 6; k++) burst(B.x + rand(-50, 50), GY - rand(20, 80), pick([C.bug, C.orb, c]), 16, 260);
        ring(B.x, GY - 50, c, 2); ring(B.x, GY - 50, C.orb, 2.6);
        scraps(B.x, GY - 60, B.info.files);
        G.stamp = { text: 'REFACTORED', sub: B.info.files != null ? `${fmtN(B.info.files)} files changed` : trunc(B.info.s, 40), col: c, t: 0 };
        G.shake = 14; G.hitstop = .3; G.slowmo = .8; G.boss = null; G.finisher.phase = 'done'; G.finisher.t = 0;
        E.say('boss-down', { hero: G.finisher.hero.name, info: B.info });
      }
    }
  }
  function startFinisher() {
    const B = G.boss; if (!B) return;
    const hero = G.heroes.find((h) => h.name === B.info.who && !h.leaving) || G.heroes.find((h) => !h.leaving);
    if (!hero) { B.state = 'dying'; B.timer = .7; G.finisher = { hero: { name: B.info.who }, phase: 'cast', t: 0 }; return; }
    G.finisher = { hero, phase: 'approach', t: 0 };
    hero.fought = true; // the finishing move is their fight
    B.state = 'stagger';
    G.enemies.forEach((e) => { if (alive(e) && !e.duel) { e.state = 'dead'; e.timer = .5; } });
  }
  function updFinisher(dt) {
    const F = G.finisher; if (!F) return;
    F.t += dt;
    if (F.phase === 'cast' && G.boss) {
      if (F.t > .35) { G.boss.flash = .1; G.boss.kx = 20; G.shake = Math.max(G.shake, 3); }
      if (F.t > 1.7 && G.boss.state !== 'dying') { G.boss.state = 'dying'; G.boss.timer = .7; }
    }
    if (F.phase === 'approach' && F.t > 6) { F.phase = 'cast'; F.t = 0; }
    if (F.phase === 'done' && F.t > 1.8) G.finisher = null;
  }

  // ---------- reverts ----------
  function fireRevert(hero, info) { G.bolts.push({ kind: 'bolt', d: hero.d, x: E.W + 20, y: GY - 70, hero, info, trail: [] }); }
  function updBolt(b, dt) {
    G.curD = b.d = b.hero.d;
    const h = b.hero, ty = GY - 70 - h.z;
    const dx = h.x - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
    b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 10) b.trail.shift();
    b.x += dx / d * 340 * dt; b.y += dy / d * 340 * dt;
    if (d < 16 || h.leaving) {
      b.done = true;
      if (h.leaving) return;
      h.state = 'down'; h.timer = 1.25; h.atk = null; h.kx = (dx < 0 ? -1 : 1) * 230; h.f = dx < 0 ? 1 : -1;
      impact(h.x, GY - 60, C.bug, 22, 'big'); G.shake = 6; G.hitstop = .1;
      floater(h.x, GY - 120, 'reverted!', C.bug, 22);
    }
  }
  function updBot(bot, dt) {
    G.curD = 0.03;
    bot.t += dt;
    if (bot.state === 'enter') { bot.x += 150 * dt; if (bot.x >= E.W * .55) { bot.state = 'plant'; bot.t = 0; } }
    else if (bot.state === 'plant' && bot.t > .5) {
      bot.state = 'leave'; bot.carry = false;
      G.flags = G.flags.slice(-2);
      G.flags.push({ x: E.W * .55 + 16, d: 0.03, tag: bot.tag, t: 0 }); dust(E.W * .55 + 16, 10); G.shake = 4;
      G.fw = 3;
    } else if (bot.state === 'leave') { bot.x += 170 * dt; if (bot.x > E.W + 60) G.bot = null; }
  }

  // ---------- one physics step ----------
  function step(dt) {
    CAM.x = lerp(CAM.x, CAM.tx, 1 - Math.exp(-5 * dt));
    // zoom in gently, zoom out fast: when a brawl starts, everyone should be on screen again within a few frames
    CAM.z = lerp(CAM.z, CAM.tz, 1 - Math.exp((CAM.tz < CAM.z ? -18 : -4) * dt));
    for (const h of G.heroes) updHero(h, dt);
    G.heroes = G.heroes.filter((h) => !(h.leaving && h.x < -80));
    for (let i = 0; i < G.heroes.length; i++) for (let j = i + 1; j < G.heroes.length; j++) {
      const a = G.heroes[i], c = G.heroes[j], d = c.x - a.x;
      if (G.boss || a.leaving || c.leaving || Math.abs(a.d - c.d) > 0.12) continue;
      if (Math.abs(d) < 32) { const p = (32 - Math.abs(d)) / 2 * (d >= 0 ? 1 : -1); a.x -= p; c.x += p; }
    }
    // heroes walk on from the left; after that they fight inside the frame until they leave
    for (const h of G.heroes) {
      h.d = clamp(h.d, 0.03, 0.97);
      if (!h.entered && h.x >= 16 && h.x <= E.W - 16) h.entered = true;
      if (h.entered && !h.leaving) h.x = clamp(h.x, 16, E.W - 16);
    }
    for (const e of G.enemies) updEnemy(e, dt);
    G.enemies = G.enemies.filter((e) => !(e.state === 'dead' && e.timer <= 0));
    if (G.boss) updBoss(G.boss, dt);
    updFinisher(dt);
    for (const x of G.bolts) updBolt(x, dt);
    G.bolts = G.bolts.filter((x) => !x.done);
    if (G.bot) updBot(G.bot, dt);
    if (G.fw > 0) { G.fw -= dt; G.fwT = (G.fwT || 0) - dt; if (G.fwT <= 0) { firework(); G.fwT = rand(.25, .5); } }
    G.cheer = Math.max(0, (G.cheer || 0) - dt);
    for (const p of G.parts) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += (p.spark ? 70 : p.puff ? -20 : p.paper ? 420 : 300) * dt; p.vx *= Math.exp((p.paper ? -2.5 : -1.5) * dt);
      if (p.paper) { p.rot += p.vr * dt; if (p.y > GY - 3) { p.y = GY - 3; p.vy = 0; p.vx *= .8; } }
      if (p.puff) p.r += dt * 14;
    }
    G.parts = G.parts.filter((p) => p.life > 0 && (p.y < GY + 4 || p.paper));
    if (G.parts.length > 600) G.parts.splice(0, G.parts.length - 600);
    for (const f of G.fx) f.life -= dt;
    G.fx = G.fx.filter((f) => f.life > 0);
    for (const f of G.floaters) { f.life -= dt; f.y -= 34 * dt; }
    G.floaters = G.floaters.filter((f) => f.life > 0);
    for (const f of G.flags) f.t += dt;
    if (G.stamp) { G.stamp.t += dt; if (G.stamp.t > 2.4) G.stamp = null; }
  }

  return {
    camTarget, camReset, step, makeEnemy, makeHero, makeBoss, home, alive, finishEnemy, startFinisher,
    fireRevert, finishInPassing, burst, dust, ring, floater, impact,
  };
}
