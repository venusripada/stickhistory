// The stage floor: fighters move across (x) and into the screen (depth d,
// 0 = back edge, 1 = front edge). Everything is still drawn as if standing on
// the old ground line GY; the player shifts and scales each fighter to the
// foot position and size for its depth, so poses and enemy drawings stay as
// they are.

import { GY } from './util.js';

export const FLOOR = { back: 262, front: 372 };

/** Screen y of a foot at depth d. */
export const footY = (d) => FLOOR.back + (FLOOR.front - FLOOR.back) * d;

/** Size at depth d: smaller at the back. */
export const scaleAt = (d) => 0.78 + 0.27 * d;

/** Each hero's own patch of floor, spread out so fights don't sit on top of each other. */
const SLOTS = [[0.10, 0.5], [0.27, 0.18], [0.27, 0.82], [0.44, 0.5], [0.61, 0.18], [0.61, 0.82]];
export function slotFor(k, W) {
  const [fx, d] = SLOTS[k % SLOTS.length];
  const lap = Math.floor(k / SLOTS.length);
  return { x: W * (fx + 0.07 * (lap % 2)), d: Math.min(0.9, Math.max(0.1, d + (lap % 2 ? 0.12 : 0) * (d > 0.5 ? -1 : 1))) };
}

/** Close enough to hit: within `reach` across, and at about the same depth. */
export const inReach = (a, b, reach, depthTolerance = 0.14) => Math.abs(a.x - b.x) <= reach && Math.abs(a.d - b.d) <= depthTolerance;

/** One step from depth `from` toward `to`, at most `step`. */
export function depthToward(from, to, step) {
  const dd = to - from;
  return Math.abs(dd) <= step ? to : from + Math.sign(dd) * step;
}

/** Canvas transform that draws something made for the ground line GY at depth d, around its foot at x. */
export function depthTransform(ctx, x, d) {
  const s = scaleAt(d);
  ctx.translate(x, footY(d));
  ctx.scale(s, s);
  ctx.translate(-x, -GY);
}
