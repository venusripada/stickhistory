// Hit stars, rings, dust, paper scraps, pop-up words and fireworks. Each one
// remembers the floor depth it happened at (E.G.curD), so it is drawn at the
// same size and place as the fighters around it; fireworks are in the sky.

import { clamp, rand, pick, GY } from './util.js';

export function makeEffects(E) {
  const { G, C } = E;
  const col = (name) => E.heroColor(name);
  function burst(x, y, color, n, sp) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(sp * .3, sp);
      G.parts.push({ d: G.curD ?? null, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: rand(.4, .9), max: .9, color, r: rand(1.5, 3.5) });
    }
  }
  function dust(x, n) {
    for (let i = 0; i < n; i++) G.parts.push({ d: G.curD ?? null, x: x + rand(-6, 6), y: GY - 2, vx: rand(-60, 60), vy: rand(-50, -10), life: rand(.3, .55), max: .55, color: C.muted, r: rand(3, 6), puff: true });
  }
  function scraps(x, y, files) {
    const n = clamp(Math.round(4 + Math.log2((files || 1) + 1) * 3), 4, 22);
    for (let i = 0; i < n; i++) G.parts.push({ d: G.curD ?? null, x, y, vx: rand(-200, 200), vy: rand(-320, -120), life: rand(.9, 1.5), max: 1.5, color: C.paper, r: rand(4, 7), paper: true, rot: rand(0, 6), vr: rand(-10, 10) });
  }
  function impact(x, y, c, r, kind) {
    E.sfx && E.sfx(kind);
    G.fx.push({ d: G.curD ?? null, t: 'star', x, y, r, col: c, life: kind === 'big' ? .18 : .12, max: kind === 'big' ? .18 : .12, n: kind === 'spark' ? 6 : 9, rot: Math.random() });
    if (kind !== 'spark') burst(x, y, c, kind === 'big' ? 10 : 5, kind === 'big' ? 220 : 120);
    if (kind === 'big') G.fx.push({ d: G.curD ?? null, t: 'lines', x, y, life: .14, max: .14, col: c });
  }
  function ring(x, y, c, scale = 1) { G.fx.push({ d: G.curD ?? null, t: 'ring', x, y, col: c, life: .35, max: .35, s: scale }); }
  function floater(x, y, text, color, size) { x = clamp(x, text.length * size * .3 + 8, E.W - text.length * size * .3 - 8); G.floaters.push({ d: G.curD ?? null, x, y, text, color, size, life: 1.1 }); if (G.floaters.length > 5) G.floaters.shift(); } // a few words at a time stay readable
  function firework() {
    E.sfx && E.sfx('pop');
    const x = rand(E.W * .15, E.W * .85), y = rand(50, 150);
    const c = pick([C.orb, ...G.heroes.map((h) => col(h.name))]);
    for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2, s = rand(70, 130); G.parts.push({ d: null, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.8, 1.3), max: 1.3, color: c, r: 2.2, spark: true }); }
  }

  return { burst, dust, scraps, impact, ring, floater, firework };
}
