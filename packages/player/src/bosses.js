// Bosses: Tech Debt and big features that spawn their commits, and the
// release hive. The fight physics for heroes and enemies is in sim.js.

import { clamp, lerp, rand, pick, fmtN, trunc, GY } from './util.js';

export function makeBosses(E, sim) {
  const { G, C } = E;
  const col = (name) => E.heroColor(name);
  const { burst, dust, scraps, impact, ring, floater, alive } = sim;
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
        G.stamp = { text: B.info.kind === 'feature' ? 'SHIPPED' : 'REFACTORED', sub: B.info.files != null ? `${fmtN(B.info.files)} files changed` : trunc(B.info.s, 40), col: c, t: 0 };
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
  E.startFinisher = startFinisher;

  /**
   * A boss arrives. With `members` (a feature or Tech Debt pull request's commits) it stays
   * shielded and spawns them a few at a time; once they're all beaten it can be hit.
   * @param {{ fixOf: (i: number) => any, ensureHero: (name: string) => any, home: (h: any) => { x: number, d: number } }} ctx
   */
  function start(ev, info, ctx) {
    G.boss = makeBoss({ ...info, kind: ev.bossKind || 'debt' });
    G.boss.minions = [...(ev.members || [])];
    G.boss.minionTotal = G.boss.minions.length;
    G.boss.shield = G.boss.minions.length > 0;
    G.boss.spawnT = 1.2;
    G.boss.ctx = ctx;
  }
  /** The boss's own commits come out of it while it's shielded; the shield drops when they're all beaten. */
  function tickBoss(dt) {
    const B = G.boss;
    if (!B || !B.shield || B.state === 'enter') return;
    B.spawnT -= dt;
    const out = G.enemies.filter((e) => e.fromBoss && alive(e)).length;
    if (B.minions.length && out < 4 && B.spawnT <= 0) {
      const fx = B.ctx.fixOf(B.minions.shift());
      const owner = B.ctx.ensureHero(fx.who);
      const e = sim.makeEnemy(fx, owner, 1, false);
      const s = B.ctx.home(owner);
      e.fromBoss = true; e.x = B.x - B.r * 0.7; e.d = B.d; e.td = s.d; e.tx = clamp(s.x + rand(50, 110), 40, E.W - 40);
      G.enemies.push(e);
      G.curD = B.d; burst(e.x, GY - 40, B.info.kind === 'feature' ? C.orb : C.bug, 8, 140);
      B.spawnT = rand(.35, .6);
    }
    if (!B.minions.length && !out) {
      B.shield = false; B.age = 0;
      G.curD = B.d; ring(B.x, GY - 50, C.orb, 1.6); floater(B.x, GY - 150, 'shield down!', C.ink, 22);
      E.say('boss-open', { bossKind: B.info.kind, title: B.info.s, who: B.info.who });
    }
  }

  /** A release under construction: this period's work comes out of it; on release day it falls. */
  function startHive(ev, tag, until, start) {
    G.hive = { kind: 'hive', tag, until, start, x: E.W * 0.8, d: 0.06, r: 60, hp: 100, state: 'building', progress: 0, flash: 0, phase: 0 };
  }
  function releaseHive(onFall) {
    const H = G.hive; if (!H) return false;
    H.state = 'assault'; H.timer = 4; H.onFall = onFall;
    return true;
  }
  function tickHive(dt) {
    const H = G.hive; if (!H) return;
    H.phase += dt; H.flash = Math.max(0, H.flash - dt);
    if (H.state === 'building') H.progress = clamp((G.day - H.start) / Math.max(0.5, H.until - H.start), 0, 1);
    if (H.state !== 'assault') return;
    H.timer -= dt;
    if (H.hp <= 0 || H.timer <= 0) {
      G.curD = H.d;
      for (let k = 0; k < 5; k++) burst(H.x + rand(-40, 40), GY - rand(20, 120), pick([C.orb, C.ink, C.gold]), 14, 240);
      scraps(H.x, GY - 80, 40); G.shake = 10;
      G.hive = null;
      if (H.onFall) H.onFall();
    }
  }

  return { makeBoss, updBoss, startFinisher, updFinisher, start, tickBoss, startHive, releaseHive, tickHive };
}
