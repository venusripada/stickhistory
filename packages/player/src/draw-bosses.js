// Drawing for the release hive, the feature boss and boss shields. Drawn
// like everything on the floor: around the ground line GY, then shifted and
// scaled to the depth by the player.

import { clamp, trunc, GY } from './util.js';
import { FD, FM } from './theme.js';

export function makeBossDraw(E, dr) {
  const { ctx, C, G } = E;

  /** A release under construction: scaffolding around stacked blocks, its tag, and how far along the period is. */
  function drawHive(H) {
    const x = H.x, w = 100, h = 110, top = GY - h;
    const col = H.flash > 0 ? C.ink : C.gold;
    ctx.save();
    ctx.globalAlpha = H.state === 'assault' ? 0.6 + 0.4 * Math.abs(Math.sin(H.phase * 10)) : 1;
    ctx.fillStyle = C.rule; ctx.beginPath(); ctx.ellipse(x, GY - 1, w * .6, 5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    // finished blocks rise with the release's progress
    const rows = 5, done = Math.max(1, Math.round(rows * H.progress));
    for (let r = 0; r < rows; r++) {
      const bw = w - r * 12, by = GY - (r + 1) * (h / rows);
      ctx.beginPath(); ctx.rect(x - bw / 2, by, bw, h / rows - 3);
      if (r < done) { ctx.fillStyle = C.paper; ctx.fill(); ctx.save(); ctx.globalAlpha *= .3; ctx.fillStyle = C.orb; ctx.fill(); ctx.restore(); ctx.stroke(); }
      else { ctx.save(); ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore(); }
    }
    // scaffold and a crane arm
    ctx.lineWidth = 2; ctx.strokeStyle = C.muted;
    ctx.beginPath(); ctx.moveTo(x - w / 2 - 10, GY); ctx.lineTo(x - w / 2 - 10, top - 20); ctx.lineTo(x + 20, top - 20); ctx.lineTo(x + 20, top - 6 + Math.sin(H.phase * 2) * 3); ctx.stroke();
    for (let y = GY - 30; y > top; y -= 30) { ctx.beginPath(); ctx.moveTo(x - w / 2 - 10, y); ctx.lineTo(x - w / 2 + 4, y - 14); ctx.stroke(); }
    ctx.restore();
    // the label sits on the hive itself, below the page's overlays
    dr.haloText(H.tag, x, GY - h * 0.55, C.ink, `700 20px ${FD}`, 'center', 4);
    dr.haloText(H.state === 'assault' ? 'release day!' : `in progress · ${Math.round(H.progress * 100)}%`, x, GY - h * 0.55 + 16, C.ink, `600 11px ${FM}`, 'center', 3);
  }

  /** A big feature still being built: a giant stack of gold crates on legs, with its name on a sign. */
  function drawFeatureBoss(B) {
    const x = B.x, s = 2.6, col = B.flash > 0 ? C.ink : C.gold;
    ctx.save();
    if (B.state === 'dying') ctx.globalAlpha = clamp(B.timer / .7, .2, 1);
    ctx.fillStyle = C.rule; ctx.beginPath(); ctx.ellipse(x, GY - 1, 70, 6, 0, 0, 7); ctx.fill();
    ctx.translate(x, GY); ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const box = (bx, by, bw, bh) => { ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.fillStyle = C.paper; ctx.fill(); ctx.save(); ctx.globalAlpha *= .25; ctx.fillStyle = C.orb; ctx.fill(); ctx.restore(); ctx.stroke(); };
    for (const i of [-1, 1]) { ctx.beginPath(); ctx.moveTo(i * 12 * s, -8 * s); ctx.lineTo(i * 14 * s + Math.sin(B.phase + i) * 4, 0); ctx.stroke(); }
    box(-20 * s, -32 * s, 40 * s, 24 * s); box(-14 * s, -54 * s, 28 * s, 22 * s);
    ctx.save(); ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.rect(-9 * s, -72 * s, 18 * s, 18 * s); ctx.stroke(); ctx.restore();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(-6 * s, -44 * s, 2.5 * s, 0, 7); ctx.arc(4 * s, -44 * s, 2.5 * s, 0, 7); ctx.fill();
    ctx.restore(); // its name is in the boss bar at the top
  }

  /** While a boss's commits are still out, it sits inside a shield. */
  function drawShield(B) {
    if (!B.shield) return;
    const pulse = 1 + Math.sin(G.time * 4) * .03;
    ctx.save(); ctx.strokeStyle = C.orb; ctx.lineWidth = 3; ctx.globalAlpha = .7;
    ctx.beginPath(); ctx.ellipse(B.x, GY - 70, 110 * pulse, 95 * pulse, 0, Math.PI, 0); ctx.lineTo(B.x + 110 * pulse, GY); ctx.lineTo(B.x - 110 * pulse, GY); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = .08; ctx.fillStyle = C.orb; ctx.fill();
    ctx.restore();
  }

  return { drawHive, drawFeatureBoss, drawShield };
}
