// Stick-figure poses and joint geometry. A pose is a set of joint angles;
// springPose eases a figure toward one, and figurePoints turns it into
// screen points standing on the ground line.

import { GY } from './util.js';

const P = (o) => Object.assign({ lean: 0, hd: 0, sA: .25, eA: .3, sB: -.2, eB: .4, hA: .12, kA: 0, hB: -.12, kB: 0, rot: 0 }, o);
export const POSES = {
  idle:     P({ lean: .04, sA: .25, eA: .35, sB: -.18, eB: .35, hA: .14, hB: -.14 }),
  stance:   P({ lean: .12, sA: 1.0, eA: 1.7, sB: .55, eB: 1.95, hA: .42, kA: -.4, hB: -.42, kB: -.2 }),
  bounce:   P({ lean: .16, sA: 1.05, eA: 1.8, sB: .6, eB: 2.0, hA: .5, kA: -.6, hB: -.45, kB: -.45 }),
  walk1:    P({ lean: .14, sA: .9, eA: 1.6, sB: .4, eB: 1.8, hA: .55, kA: -.15, hB: -.45, kB: -.6 }),
  walk2:    P({ lean: .14, sA: .8, eA: 1.7, sB: .5, eB: 1.8, hA: -.4, kA: -.65, hB: .5, kB: -.1 }),
  dash1:    P({ lean: .6, sA: -.9, eA: .3, sB: -1.1, eB: .2, hA: .9, kA: -.4, hB: -.7, kB: -.9 }),
  dash2:    P({ lean: .6, sA: -.9, eA: .3, sB: -1.1, eB: .2, hA: -.5, kA: -1.1, hB: .95, kB: -.3 }),
  chamber:  P({ lean: .02, sA: .35, eA: 2.4, sB: .7, eB: 1.9, hA: .45, kA: -.45, hB: -.45, kB: -.25 }),
  jab:      P({ lean: .45, sA: 1.25, eA: 0, sB: .15, eB: 2.3, hA: .7, kA: -.35, hB: -.62, kB: 0 }),
  cross:    P({ lean: .5, sA: .5, eA: 2.2, sB: 1.3, eB: 0, hA: .7, kA: -.4, hB: -.55, kB: 0 }),
  knee:     P({ lean: -.1, sA: .9, eA: 1.6, sB: -.3, eB: 1.2, hA: 1.4, kA: -1.8, hB: -.05, kB: -.05 }),
  kick:     P({ lean: -.34, sA: .8, eA: 1.4, sB: -.75, eB: .8, hA: 1.45, kA: 0, hB: -.08, kB: -.05 }),
  hikick:   P({ lean: -.55, sA: .6, eA: 1.6, sB: -1.0, eB: .6, hA: 2.0, kA: 0, hB: -.05, kB: 0 }),
  raise:    P({ lean: -.18, sA: 2.95, eA: .3, sB: 2.75, eB: .4, hA: .3, kA: -.2, hB: -.3, kB: -.1 }),
  smash:    P({ lean: .62, sA: 1.05, eA: .1, sB: .95, eB: .2, hA: .62, kA: -.75, hB: -.45, kB: -.4 }),
  crouch:   P({ lean: .25, sA: .6, eA: 1.6, sB: -.4, eB: 1.2, hA: .85, kA: -1.6, hB: .15, kB: -1.4 }),
  ucwind:   P({ lean: .35, sA: .1, eA: 2.4, sB: .7, eB: 1.9, hA: .9, kA: -1.5, hB: -.2, kB: -1.0 }),
  uppercut: P({ lean: -.18, sA: 2.95, eA: .15, sB: .3, eB: 1.9, hA: .25, kA: 0, hB: -.55, kB: -.3 }),
  sweep:    P({ lean: .55, sA: .4, eA: 1.2, sB: -.6, eB: .8, hA: 1.5, kA: .05, hB: .95, kB: -2.1 }),
  flykick:  P({ lean: -.38, sA: 2.2, eA: .4, sB: -1.6, eB: .3, hA: 1.75, kA: 0, hB: .5, kB: -1.9 }),
  tuck:     P({ lean: .3, sA: 1.2, eA: 1.8, sB: .9, eB: 2.0, hA: 1.5, kA: -2.2, hB: 1.2, kB: -2.1 }),
  slam:     P({ lean: .75, sA: 1.45, eA: 0, sB: 1.25, eB: .1, hA: 1.1, kA: -1.7, hB: .5, kB: -1.6 }),
  backstep: P({ lean: -.28, sA: 1.4, eA: 2.1, sB: 1.0, eB: 2.2, hA: .55, kA: -.25, hB: -.65, kB: -.45 }),
  block:    P({ lean: -.12, sA: 1.35, eA: 2.3, sB: 1.1, eB: 2.4, hA: .35, kA: -.3, hB: -.45, kB: -.1 }),
  parry:    P({ lean: .05, sA: 2.0, eA: .7, sB: .7, eB: 1.9, hA: .5, kA: -.3, hB: -.5, kB: -.15 }),
  hurt:     P({ lean: -.55, hd: -.35, sA: -.5, eA: .4, sB: -1.0, eB: .5, hA: .35, kA: -.45, hB: -.25, kB: -.2 }),
  down:     P({ lean: 0, hd: .2, sA: 2.6, eA: .3, sB: -2.4, eB: -.3, hA: .2, kA: -.4, hB: -.1, kB: -.1, rot: -1.48 }),
  victory:  P({ lean: 0, sA: 2.75, eA: .15, sB: -2.75, eB: -.15, hA: .25, kA: 0, hB: -.25, kB: 0 }),
  cheer:    P({ lean: .05, sA: 2.4, eA: .9, sB: .2, eB: .4, hA: .15, kA: 0, hB: -.15, kB: 0 }),
  point:    P({ lean: .05, sA: 1.75, eA: 0, sB: -.2, eB: .3, hA: .3, kA: -.1, hB: -.3, kB: -.1 }),
  catch:    P({ lean: -.1, hd: -.4, sA: 2.95, eA: .1, sB: 2.85, eB: .15, hA: .2, kA: -.2, hB: -.2, kB: -.2 }),
  cast:     P({ lean: .22, sA: 1.55, eA: .05, sB: 1.45, eB: .15, hA: .7, kA: -.3, hB: -.65, kB: 0 }),
};
export const PKEYS = Object.keys(POSES.idle);
export const zeroPose = () => { const o = {}; PKEYS.forEach((k) => { o[k] = 0; }); return o; };
export function springPose(h, tgt, k, dt) {
  // damped spring per joint: snappy, with a little overshoot for follow-through
  const d = 2 * Math.sqrt(k) * 0.72;
  const n = Math.max(1, Math.ceil(dt / 0.006)), st = dt / n;
  for (let i = 0; i < n; i++) for (const key of PKEYS) {
    const a = k * (tgt[key] - h.pose[key]) - d * h.pv[key];
    h.pv[key] += a * st; h.pose[key] += h.pv[key] * st;
  }
}

export const L = { torso: 30, head: 9, ua: 16, fa: 15, th: 19, sh: 19 };
export function hash(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }
export function figurePoints(E, p, x, z, f, seed, jitter = true) {
  const v = (a, len) => ({ x: Math.sin(a) * f * len, y: Math.cos(a) * len });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const hip = { x: 0, y: 0 };
  const up = Math.PI - p.lean;
  const neck = add(hip, v(up, L.torso));
  const shoulder = add(hip, v(up, L.torso * 0.9));
  const head = add(neck, v(up - p.hd, L.head + 3));
  const eA = add(shoulder, v(p.sA, L.ua)), hA = add(eA, v(p.sA + p.eA, L.fa));
  const eB = add(shoulder, v(p.sB, L.ua)), hB = add(eB, v(p.sB + p.eB, L.fa));
  const kA = add(hip, v(p.hA, L.th)), fA = add(kA, v(p.hA + p.kA, L.sh));
  const kB = add(hip, v(p.hB, L.th)), fB = add(kB, v(p.hB + p.kB, L.sh));
  const pts = { hip, neck, shoulder, head, eA, hA, eB, hB, kA, fA, kB, fB };
  const th = p.rot * f, c = Math.cos(th), s = Math.sin(th);
  let maxY = -1e9;
  for (const k in pts) {
    const q = pts[k];
    const rx = q.x * c - q.y * s, ry = q.x * s + q.y * c;
    q.x = rx; q.y = ry;
    const lowest = k === 'head' ? ry + L.head : ry;
    if (lowest > maxY) maxY = lowest;
  }
  const shift = (GY - z) - maxY - 1;
  const bucket = Math.floor(E.G.time * 8);
  const j = (E.reduceMotion || !jitter) ? 0 : 0.6;
  let i = 0;
  for (const k in pts) {
    const q = pts[k];
    q.x += x + (hash(seed * 31 + i * 7 + bucket) * 2 - 1) * j;
    q.y += shift + (hash(seed * 17 + i * 13 + bucket * 3) * 2 - 1) * j;
    i++;
  }
  return pts;
}

// Attack moves: wind-up pose, strike pose, timings, damage and knockback.
export const MOVES = {
  jab:      { wind: 'chamber', strike: 'jab', tw: .06, th: .09, tr: .22, dmg: 1, kb: 110, reach: 30 },
  cross:    { wind: 'chamber', strike: 'cross', tw: .06, th: .1, tr: .25, dmg: 1, kb: 150, reach: 32 },
  kick:     { wind: 'knee', strike: 'kick', tw: .1, th: .14, tr: .32, dmg: 1, kb: 200, reach: 38 },
  hikick:   { wind: 'knee', strike: 'hikick', tw: .12, th: .16, tr: .38, dmg: 1, kb: 240, reach: 38, air: true },
  smash:    { wind: 'raise', strike: 'smash', tw: .16, th: .2, tr: .42, dmg: 1.5, kb: 60, reach: 30, squash: true },
  sweep:    { wind: 'crouch', strike: 'sweep', tw: .08, th: .12, tr: .34, dmg: 1, kb: 60, reach: 40, pop: 220 },
  uppercut: { wind: 'ucwind', strike: 'uppercut', tw: .1, th: .13, tr: .38, dmg: 1, kb: 40, reach: 30, launch: 560 },
  dash:     { wind: 'dash1', strike: 'cross', tw: .2, th: .24, tr: .44, dmg: 1.5, kb: 300, reach: 34, rush: 520 },
  air:      { wind: 'crouch', strike: 'slam', tw: .1, th: .4, tr: .7, dmg: 1.5, kb: 80, reach: 46, jump: true, spike: true },
  fly:      { wind: 'crouch', strike: 'flykick', tw: .12, th: .3, tr: .56, dmg: 1.5, kb: 280, reach: 44, jump: true },
};
export const CHAINS = [
  ['jab', 'cross', 'kick', 'uppercut', 'air'],
  ['jab', 'jab', 'sweep', 'uppercut', 'air'],
  ['kick', 'cross', 'smash', 'dash'],
  ['jab', 'hikick', 'uppercut', 'air'],
  ['dash', 'jab', 'cross', 'fly'],
];
