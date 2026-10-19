// Drawing: paper, ground, stick figures, enemies, the boss, effects and the
// on-canvas cards. makeDraw(E) binds to one canvas context; the player
// makes a second one for legend icons.

import { L, hash, figurePoints } from './poses.js';
import { clamp, lerp, rand, fmtN, fmtDate, trunc, fixTag, fixKind, ETYPES, H, GY } from './util.js';
import { FD, FM } from './theme.js';

export function makeDraw(E) {
  const { ctx, C, G, CAM } = E;
  const alive = (e) => e.state !== 'dead';
  // the page may cover strips at the sides with overlays; cards and bars centre in what's left
  const mid = () => (E.inset.l + E.W - E.inset.r) / 2;
  const span = () => Math.max(160, E.W - E.inset.l - E.inset.r);
  function worldTransform(shx, shy) {
    const z = CAM.z, S = E.S, D = E.DPR;
    ctx.setTransform(D * S * z, 0, 0, D * S * z, D * S * (E.W / 2 - CAM.x * z + shx), D * S * (GY - GY * z + shy));
  }
  function screenTransform() { ctx.setTransform(E.DPR * E.S, 0, 0, E.DPR * E.S, 0, 0); }

  function haloText(text, x, y, color, font, align = 'center', halo = 4) {
    ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round'; ctx.lineWidth = halo; ctx.strokeStyle = C.paper; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function drawPaper() {
    screenTransform();
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, E.W, H);
  }
  function drawGrid() {
    const vw = E.W / CAM.z, x0 = CAM.x - vw / 2 - 40, x1 = CAM.x + vw / 2 + 40;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1 / CAM.z;
    ctx.beginPath();
    for (let x = Math.floor(x0 / 20) * 20; x < x1; x += 20) { ctx.moveTo(x, -200); ctx.lineTo(x, H + 100); }
    for (let y = 12 - 200; y < H + 100; y += 20) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  }
  function drawGround() {
    const x0 = E.W * .2, x1 = E.W * .64, by = GY + 26;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, GY);
    ctx.bezierCurveTo(x0 + 28, GY, x0 + 28, by, x0 + 56, by); ctx.lineTo(x1 - 56, by);
    ctx.bezierCurveTo(x1 - 28, by, x1 - 28, GY, x1, GY); ctx.stroke();
    ctx.fillStyle = C.paper;
    for (let k = 1; k <= 3; k++) { const x = lerp(x0 + 56, x1 - 56, k / 4); ctx.beginPath(); ctx.arc(x, by, 3.5, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-200, GY); ctx.lineTo(E.W + 200, GY); ctx.stroke();
    ctx.lineWidth = 2;
    for (let x = 24; x < E.W; x += 48) { ctx.beginPath(); ctx.arc(x, GY, 4.5, 0, 7); ctx.fillStyle = C.paper; ctx.fill(); ctx.stroke(); }
    ctx.font = `11px ${FM}`; ctx.fillStyle = C.muted; ctx.textAlign = 'left';
    ctx.fillText(E.EP.summary.branch || 'main', 8, GY + 20);
  }
  function strokeFigure(p, col, lw, alphaBack) {
    const seg = (...pts) => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); };
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * alphaBack; seg(p.hip, p.kB, p.fB); seg(p.shoulder, p.eB, p.hB); ctx.globalAlpha = a;
    seg(p.hip, p.neck); seg(p.hip, p.kA, p.fA); seg(p.shoulder, p.eA, p.hA);
    return seg;
  }
  function drawFigure(h) {
    const col = E.heroColor(h.name);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // afterimages
    for (const t of h.trail) { ctx.globalAlpha = t.life / .16 * .28; strokeFigure(t.pts, col, 3, .6); ctx.beginPath(); ctx.arc(t.pts.head.x, t.pts.head.y, L.head, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = h.leaving ? .6 : 1;
    const p = figurePoints(E, h.pose, h.x, h.z, h.f, h.seed);
    if (h.aura > 0) {
      const r = 46 + Math.sin(G.time * 6) * 4;
      const g = ctx.createRadialGradient(p.neck.x, p.neck.y + 8, 6, p.neck.x, p.neck.y + 8, r);
      g.addColorStop(0, C.orb); g.addColorStop(1, 'rgba(0,0,0,0)');
      const a = ctx.globalAlpha; ctx.globalAlpha = a * .28; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.neck.x, p.neck.y + 8, r, 0, 7); ctx.fill(); ctx.globalAlpha = a;
    }
    // ground shadow
    ctx.fillStyle = C.rule; ctx.beginPath(); ctx.ellipse(h.x, GY - 1, 16 - Math.min(h.z, 80) / 10, 3, 0, 0, 7); ctx.fill();
    const tw = Math.sin(G.time * 14 + h.k) * 3;
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(p.head.x - h.f * 7, p.head.y - 3); ctx.lineTo(p.head.x - h.f * 19, p.head.y - 1 + tw); ctx.lineTo(p.head.x - h.f * 27, p.head.y + 3 - tw); ctx.stroke();
    const seg = strokeFigure(p, col, 4, .5);
    ctx.beginPath(); ctx.arc(p.head.x, p.head.y, L.head, 0, 7); ctx.fillStyle = C.paper; ctx.fill(); ctx.lineWidth = 3.5; ctx.stroke();
    ctx.lineWidth = 3; seg({ x: p.head.x - 9, y: p.head.y - 3 }, { x: p.head.x + 9, y: p.head.y - 3 });
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.head.x + h.f * 4, p.head.y + 1, 1.6, 0, 7); ctx.fill();
    // fists
    if (h.state === 'attack') { ctx.beginPath(); ctx.arc(p.hA.x, p.hA.y, 3.2, 0, 7); ctx.fill(); }
    if (h.state === 'down' || h.state === 'hurt') {
      ctx.fillStyle = C.orb;
      for (let k = 0; k < 3; k++) { const a = G.time * 5 + k * 2.1; ctx.beginPath(); ctx.arc(p.head.x + Math.cos(a) * 14, p.head.y - 14 + Math.sin(a) * 4, 2, 0, 7); ctx.fill(); }
    }
    haloText(h.name, p.head.x, Math.min(p.head.y, p.hip.y) - 18 - (h.k % 2) * 14, col, `600 13px ${FM}`);
    ctx.globalAlpha = 1;
    return p;
  }
  function drawEnemy(e) {
    const s = e.s, f = e.f, T = e.T;
    const bob = T.hover ? Math.sin(e.phase * .5) * 4 : 0;
    const by = GY - e.z - T.hover - bob;
    const col = e.flash > 0 ? C.ink : C.bug;
    const sq = clamp(e.sq * .05, -.3, .3);
    // shadow
    ctx.fillStyle = C.rule; ctx.beginPath(); ctx.ellipse(e.x, GY - 1, e.r * (1 - Math.min(e.z + T.hover, 120) / 240), 3, 0, 0, 7); ctx.fill();
    ctx.save();
    ctx.globalAlpha = e.alpha;
    ctx.translate(e.x, by);
    if (e.state === 'dead') ctx.rotate(e.rot * .4);
    ctx.scale(1 + sq, 1 - sq);
    if (e.type === 'moth' && !E.reduceMotion && Math.random() < .04) ctx.globalAlpha *= .4;
    ctx.strokeStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const tint = () => { ctx.save(); ctx.globalAlpha *= .2; ctx.fillStyle = C.bug; ctx.fill(); ctx.restore(); };
    const shell = () => { ctx.fillStyle = C.paper; ctx.fill(); tint(); ctx.stroke(); };
    const eye = (x, y, r) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
    const ph = e.phase;
    if (e.type === 'gremlin') {
      for (const i of [-1, 1]) { ctx.beginPath(); ctx.moveTo(i * 6 * s, -10 * s); ctx.lineTo(i * 8 * s + Math.sin(ph + i) * 3, -2 * s); ctx.lineTo(i * 6 * s + f * 4, 0); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, -22 * s, 16 * s, 0, 7); shell();
      ctx.beginPath(); for (let k = 0; k < 4; k++) { const a = Math.PI + .4 + k * .45; const bx = -f * Math.cos(a) * 16 * s, byy = -22 * s + Math.sin(a) * 16 * s; ctx.moveTo(bx, byy); ctx.lineTo(bx - f * 8 * s * Math.cos(a - .3) * -1, byy + Math.sin(a) * 9 * s); } ctx.stroke();
      ctx.beginPath(); ctx.moveTo(f * 6 * s, -36 * s); ctx.lineTo(f * 16 * s, -46 * s); ctx.lineTo(f * 13 * s, -32 * s); ctx.stroke();
      eye(f * 9 * s, -26 * s, 2.6 * s); eye(f * 3 * s, -27 * s, 2.2 * s);
      ctx.beginPath(); ctx.moveTo(f * 2 * s, -15 * s); for (let k = 0; k < 4; k++) ctx.lineTo(f * (4 + k * 3) * s, (k % 2 ? -18 : -14) * s); ctx.stroke();
    } else if (e.type === 'beetle') {
      for (let i = -1; i <= 1; i++) { const ox = i * 13 * s; ctx.beginPath(); ctx.moveTo(ox, -8 * s); ctx.lineTo(ox + f * 5 * s + Math.sin(ph + i * 2) * 3, -3 * s); ctx.lineTo(ox + f * 8 * s + Math.sin(ph + i * 2) * 5, 0); ctx.stroke(); }
      ctx.beginPath(); ctx.ellipse(0, -16 * s, 26 * s, 17 * s, 0, Math.PI, 0); ctx.lineTo(26 * s, -8 * s); ctx.lineTo(-26 * s, -8 * s); ctx.closePath(); shell();
      ctx.beginPath(); ctx.moveTo(0, -33 * s); ctx.lineTo(0, -8 * s); ctx.moveTo(-14 * s, -29 * s); ctx.quadraticCurveTo(-8 * s, -18 * s, -14 * s, -8 * s); ctx.moveTo(14 * s, -29 * s); ctx.quadraticCurveTo(8 * s, -18 * s, 14 * s, -8 * s); ctx.stroke();
      ctx.beginPath(); ctx.arc(f * 30 * s, -12 * s, 8 * s, 0, 7); shell();
      ctx.beginPath(); ctx.moveTo(f * 34 * s, -18 * s); ctx.quadraticCurveTo(f * 44 * s, -26 * s, f * 46 * s, -36 * s); ctx.stroke();
      eye(f * 33 * s, -13 * s, 1.8 * s);
    } else if (e.type === 'crawler') {
      for (let i = 4; i >= 0; i--) {
        const sx = -f * i * 13 * s, sy = -11 * s + Math.sin(ph * .6 + i) * 2.5 * s;
        ctx.beginPath(); ctx.moveTo(sx - 3 * s, sy + 6 * s); ctx.lineTo(sx - 5 * s + Math.sin(ph + i) * 2, 0); ctx.moveTo(sx + 3 * s, sy + 6 * s); ctx.lineTo(sx + 5 * s + Math.cos(ph + i) * 2, 0); ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, (i === 0 ? 11 : 9.5 - i * .6) * s, 0, 7); shell();
      }
      eye(f * 4 * s, -14 * s, 2.2 * s);
      ctx.beginPath(); ctx.moveTo(f * 6 * s, -20 * s); ctx.quadraticCurveTo(f * 12 * s, -32 * s, f * 20 * s, -30 * s + Math.sin(ph) * 2); ctx.moveTo(f * 2 * s, -21 * s); ctx.quadraticCurveTo(f * 4 * s, -34 * s, f * 12 * s, -37 * s + Math.cos(ph) * 2); ctx.stroke();
    } else if (e.type === 'wraith') {
      ctx.beginPath(); ctx.moveTo(-15 * s, -8 * s);
      ctx.lineTo(-15 * s, -30 * s); ctx.arc(0, -30 * s, 15 * s, Math.PI, 0); ctx.lineTo(15 * s, -8 * s);
      for (let k = 0; k < 5; k++) ctx.lineTo(15 * s - (k + .5) * 6 * s, (-8 + (k % 2 ? -4 : 3) + Math.sin(ph + k) * 1.5) * s);
      ctx.closePath(); ctx.save(); ctx.globalAlpha *= .85; shell(); ctx.restore();
      ctx.beginPath(); ctx.ellipse(f * 5 * s, -32 * s, 3 * s, 5 * s, 0, 0, 7); ctx.ellipse(-f * 4 * s, -32 * s, 3 * s, 5 * s, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(f * 1 * s, -21 * s, 4 * s, 2.5 * s, 0, 0, 7); ctx.stroke();
    } else if (e.type === 'moth') {
      const fl = Math.sin(ph * 2.2);
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(-f * 2 * s, -10 * s);
        ctx.quadraticCurveTo(-f * 22 * s, (-10 - side * 22 * (.6 + .4 * fl)) * s, -f * 30 * s, (-10 - side * 6) * s);
        ctx.quadraticCurveTo(-f * 14 * s, (-10 + side * 2) * s, -f * 2 * s, -10 * s); shell();
      }
      ctx.beginPath(); ctx.ellipse(0, -10 * s, 11 * s, 6 * s, 0, 0, 7); shell();
      ctx.beginPath(); ctx.arc(f * 12 * s, -11 * s, 5.5 * s, 0, 7); shell();
      eye(f * 14 * s, -12 * s, 1.8 * s);
      ctx.beginPath(); ctx.moveTo(f * 14 * s, -16 * s); ctx.quadraticCurveTo(f * 18 * s, -26 * s, f * 26 * s, -26 * s); ctx.stroke();
    } else if (e.type === 'bomb') {
      for (const i of [-1, 1]) { ctx.beginPath(); ctx.moveTo(i * 7 * s, -6 * s); ctx.lineTo(i * 9 * s + Math.sin(ph + i * 2) * 3, 0); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, -22 * s, 17 * s, 0, 7); ctx.fillStyle = C.paper; ctx.fill(); ctx.save(); ctx.globalAlpha *= .4; ctx.fillStyle = C.bug; ctx.fill(); ctx.restore(); ctx.stroke();
      ctx.beginPath(); ctx.rect(-5 * s, -44 * s, 10 * s, 6 * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -44 * s); ctx.quadraticCurveTo(-f * 8 * s, -54 * s, -f * 2 * s, -60 * s); ctx.stroke();
      if (Math.random() < .7) { ctx.fillStyle = C.orb; ctx.beginPath(); ctx.arc(-f * 2 * s + rand(-2, 2), -61 * s + rand(-2, 2), rand(2, 4), 0, 7); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(f * 3 * s, -29 * s); ctx.lineTo(f * 10 * s, -26 * s); ctx.moveTo(f * 13 * s, -29 * s); ctx.lineTo(f * 10 * s, -26 * s); ctx.stroke();
      eye(f * 6 * s, -23 * s, 2 * s); eye(f * 12 * s, -23 * s, 2 * s);
    }
    ctx.restore();
    if (e.state !== 'dead') {
      const top = by - (e.type === 'bomb' ? 66 : e.type === 'beetle' ? 44 : e.type === 'crawler' ? 42 : e.type === 'wraith' ? 50 : e.type === 'moth' ? 34 : 50) * s;
      if (e.state === 'tele') haloText('!', e.x, top - 18, C.bug, `700 30px ${FD}`, 'center', 5);
      if (!e.duel) haloText(fixTag(e.fx), e.x, top, C.bug, `10px ${FM}`, 'center', 3);
      if (e.author && !e.duel) { ctx.fillStyle = E.heroColor(e.author); ctx.beginPath(); ctx.arc(e.x - fixTag(e.fx).length * 3.2 - 6, top - 4, 3, 0, 7); ctx.fill(); }
    }
  }
  function drawBoss(B) {
    const r = B.r, cx = B.x, cy = GY - 52;
    const col = B.flash > 0 ? C.ink : C.bug;
    ctx.save();
    if (B.state === 'dying') ctx.globalAlpha = clamp(B.timer / .7, .2, 1);
    ctx.fillStyle = C.rule; ctx.beginPath(); ctx.ellipse(cx, GY - 1, r * 1.2, 5, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = -2; i <= 2; i++) { const ox = cx + i * 24, ph = B.phase + i; ctx.beginPath(); ctx.moveTo(ox, cy + 28); ctx.lineTo(ox - 10 + Math.sin(ph) * 3, cy + 42); ctx.lineTo(ox - 18 + Math.sin(ph) * 5, GY); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * .58, 0, 0, 7); ctx.fillStyle = C.paper; ctx.fill(); ctx.stroke();
    ctx.save(); ctx.globalAlpha *= .2; ctx.fillStyle = C.bug; ctx.fill(); ctx.restore();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 20, cy - 38); ctx.lineTo(cx - 10, cy - 20); ctx.lineTo(cx - 22, cy - 6); ctx.moveTo(cx + 30, cy - 30); ctx.lineTo(cx + 22, cy - 12); ctx.lineTo(cx + 36, cy + 4); ctx.stroke();
    ctx.font = `700 22px ${FD}`; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText('TECH DEBT', cx + 6, cy + 10);
    const hx = cx - r - 14, hy = cy + 4;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(hx, hy, 20, 0, 7); ctx.fillStyle = C.paper; ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(hx - 7, hy - 5, 3.5, 0, 7); ctx.arc(hx + 4, hy - 7, 3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx - 4, hy - 18); ctx.lineTo(hx - 14, hy - 38); ctx.lineTo(hx - 2, hy - 26); ctx.moveTo(hx + 6, hy - 18); ctx.lineTo(hx + 8, hy - 40); ctx.lineTo(hx + 14, hy - 22); ctx.stroke();
    const ca = -0.4 - B.claw * 1.2, sx = cx - r * .6, sy = cy - 10;
    const ex = sx + Math.cos(Math.PI + ca) * 46, ey = sy + Math.sin(Math.PI + ca) * 46;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(ex - 18, ey + 10); ctx.moveTo(ex, ey); ctx.lineTo(ex - 14, ey - 12); ctx.stroke();
    if (B.state === 'wind') haloText('!', hx, hy - 50, C.bug, `700 34px ${FD}`, 'center', 5);
    ctx.restore();
  }
  function drawBeam() {
    const F = G.finisher; if (!F || F.phase !== 'cast' || !G.boss) return;
    const h = F.hero, p = figurePoints(E, h.pose, h.x, h.z, h.f, h.seed);
    const sx = (p.hA.x + p.hB.x) / 2, sy = (p.hA.y + p.hB.y) / 2;
    const tx = G.boss.x - G.boss.r * .4, ty = GY - 52;
    const prog = clamp(F.t / .4, 0, 1);
    const ex = lerp(sx, tx, prog), ey = lerp(sy, ty, prog);
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = C.orb; ctx.globalAlpha = .45; ctx.lineWidth = 22 + Math.sin(G.time * 30) * 4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = E.heroColor(h.name); ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
  }
  function drawOrb(o) {
    const r = 10 + Math.sin(G.time * 8) * 1.2;
    ctx.save();
    ctx.globalAlpha = .3; ctx.fillStyle = C.orb; ctx.beginPath(); ctx.arc(o.x, o.y, r * 2.2, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = `700 14px ${FD}`; ctx.textAlign = 'center'; ctx.fillText('★', o.x, o.y + 5);
    ctx.restore();
    haloText(trunc(o.info.s, 34), o.x, o.y - 20, C.gold, `600 11px ${FM}`, o.x < 120 ? 'left' : o.x > E.W - 120 ? 'right' : 'center');
  }
  function drawBolt(b) {
    ctx.save(); ctx.strokeStyle = C.bug; ctx.lineCap = 'round';
    b.trail.forEach((t, i) => { ctx.globalAlpha = i / b.trail.length * .5; ctx.lineWidth = 2 + i * .4; ctx.beginPath(); ctx.arc(t.x, t.y, 3, 0, 7); ctx.stroke(); });
    ctx.globalAlpha = 1; ctx.lineWidth = 3;
    const a0 = G.time * 10;
    ctx.beginPath(); ctx.arc(b.x, b.y, 11, a0, a0 + Math.PI * 1.6); ctx.stroke();
    const ax = b.x + Math.cos(a0) * 11, ay = b.y + Math.sin(a0) * 11;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.cos(a0 - 2.2) * 7, ay + Math.sin(a0 - 2.2) * 7); ctx.moveTo(ax, ay); ctx.lineTo(ax + Math.cos(a0 - .6) * 7, ay + Math.sin(a0 - .6) * 7); ctx.stroke();
    ctx.restore();
    haloText('revert', b.x, b.y - 18, C.bug, `600 11px ${FM}`);
  }
  function drawFlag(fl) {
    const x = fl.x, top = GY - 86;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, GY); ctx.lineTo(x, top); ctx.stroke();
    ctx.font = `700 13px ${FM}`;
    const w = ctx.measureText(fl.tag).width + 18, hgt = 24, wv = Math.sin(fl.t * 6) * 3;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.quadraticCurveTo(x + w / 2, top + wv, x + w, top + 2);
    ctx.lineTo(x + w, top + hgt + 2); ctx.quadraticCurveTo(x + w / 2, top + hgt + wv, x, top + hgt); ctx.closePath();
    ctx.fillStyle = C.orb; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.fillText(fl.tag, x + 9, top + 17);
  }
  function drawBot(bot) {
    const x = bot.x, by = GY;
    ctx.save(); ctx.strokeStyle = C.ink; ctx.fillStyle = C.paper; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(x, by - 8, 8, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + Math.cos(G.time * 9) * 8, by - 8 + Math.sin(G.time * 9) * 8); ctx.lineTo(x, by - 8); ctx.stroke();
    ctx.fillRect(x - 13, by - 40, 26, 24); ctx.strokeRect(x - 13, by - 40, 26, 24);
    ctx.fillRect(x - 10, by - 58, 20, 15); ctx.strokeRect(x - 10, by - 58, 20, 15);
    ctx.beginPath(); ctx.moveTo(x, by - 58); ctx.lineTo(x, by - 68); ctx.stroke();
    ctx.fillStyle = (Math.floor(G.time * 4) % 2) ? C.orb : C.bug; ctx.beginPath(); ctx.arc(x, by - 70, 3, 0, 7); ctx.fill();
    ctx.fillStyle = C.ink; ctx.fillRect(x - 6, by - 53, 4, 4); ctx.fillRect(x + 3, by - 53, 4, 4);
    if (bot.carry) {
      ctx.beginPath(); ctx.moveTo(x + 12, by - 30); ctx.lineTo(x + 22, by - 30); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 22, by - 10); ctx.lineTo(x + 22, by - 92); ctx.stroke();
      ctx.fillStyle = C.orb; ctx.beginPath(); ctx.moveTo(x + 22, by - 92); ctx.lineTo(x + 48, by - 84); ctx.lineTo(x + 22, by - 76); ctx.closePath(); ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    haloText('release bot', x, by - 80 - (bot.carry ? 20 : 0), C.muted, `11px ${FM}`);
  }
  function drawFx() {
    for (const f of G.fx) {
      const k = clamp(f.life / f.max, 0, 1);
      if (f.t === 'star') {
        const r = f.r * (0.6 + (1 - k) * .7);
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
        ctx.beginPath();
        for (let i = 0; i < f.n * 2; i++) { const a = i / (f.n * 2) * Math.PI * 2, rr = i % 2 ? r * .42 : r * (0.85 + hash(i + f.rot * 10) * .3); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = C.orb; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * .25, 0, 7); ctx.fillStyle = C.paper; ctx.fill();
        ctx.restore();
      } else if (f.t === 'ring') {
        ctx.globalAlpha = k; ctx.strokeStyle = f.col; ctx.lineWidth = 3 * k + .5;
        ctx.beginPath(); ctx.ellipse(f.x, f.y, (1 - k) * 70 * f.s + 6, (1 - k) * 40 * f.s + 4, 0, 0, 7); ctx.stroke();
      } else if (f.t === 'lines') {
        ctx.globalAlpha = k; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + .2, r0 = 30 + (1 - k) * 30, r1 = r0 + 22; ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawParts() {
    for (const p of G.parts) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.4, 0, 1) * (p.puff ? .35 : 1);
      if (p.paper) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
        ctx.fillRect(-p.r, -p.r * 1.3, p.r * 2, p.r * 2.6); ctx.strokeRect(-p.r, -p.r * 1.3, p.r * 2, p.r * 2.6);
        ctx.beginPath(); ctx.moveTo(-p.r * .6, -p.r * .5); ctx.lineTo(p.r * .6, -p.r * .5); ctx.moveTo(-p.r * .6, p.r * .2); ctx.lineTo(p.r * .3, p.r * .2); ctx.stroke();
        ctx.restore();
      } else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    for (const f of G.floaters) { ctx.globalAlpha = clamp(f.life * 1.6, 0, 1); haloText(f.text, f.x, f.y, f.color, `700 ${f.size}px ${FD}`, 'center', 5); }
    ctx.globalAlpha = 1;
  }
  function highlight(text, x, y, size) {
    ctx.font = `700 ${size}px ${FD}`;
    const w = ctx.measureText(text).width;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-.025);
    ctx.fillStyle = C.hl; ctx.fillRect(-w / 2 - 10, -size * .45, w + 20, size * .6);
    ctx.restore();
    ctx.fillStyle = C.hlInk; ctx.textAlign = 'center'; ctx.fillText(text, x, y);
  }
  function fitSize(text, max, size, font) { ctx.font = `700 ${size}px ${font}`; const w = ctx.measureText(text).width; return w > max ? Math.floor(size * max / w) : size; }
  function drawCard(lines) {
    ctx.globalAlpha = lines.alpha ?? 1;
    let y = lines.top || 120;
    for (const l of lines.rows) {
      if (l.kind === 'eyebrow') { ctx.font = `600 12px ${FM}`; ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.fillText(l.text.toUpperCase(), mid(), y); y += 46; }
      else if (l.kind === 'title') { highlight(l.text, mid(), y, fitSize(l.text, span() - 60, 52, FD)); y += 34; }
      else if (l.kind === 'sub') { haloText(l.text, mid(), y, C.ink, `700 ${fitSize(l.text, span() - 40, 22, FD)}px ${FD}`); y += 26; }
      else if (l.kind === 'mono') { haloText(trunc(l.text, Math.floor((span() - 30) / 7.6)), mid(), y, l.color || C.muted, `${l.weight || 400} 12.5px ${FM}`); y += 22; }
      else if (l.kind === 'gap') y += l.h;
    }
    ctx.globalAlpha = 1;
  }
  function drawDuelHud() {
    const D = G.duel; if (!D) return;
    const e = D.enemy, fx = D.fx, col = E.heroColor(D.hero.name);
    // enemy bar, centred so the side overlays never cover it: files left to clean up
    const w = Math.min(span() * .6, 260), x = mid() - w / 2, y = 40;
    const units = fx.files != null ? fx.files : e.need;
    const left = alive(e) ? Math.max(0, Math.ceil(units * e.hp / e.need)) : 0;
    haloText(`${D.hero.name} vs ${fixTag(fx)} · ${ETYPES[e.type].name}`, mid(), y - 8, C.bug, `600 12px ${FM}`, 'center', 4);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.fillStyle = C.paper; ctx.fillRect(x, y, w, 14); ctx.strokeRect(x, y, w, 14);
    ctx.fillStyle = C.bug; ctx.fillRect(x + 2, y + 2, (w - 4) * clamp(e.hp / e.need, 0, 1), 10);
    haloText(fx.files != null ? `${left} of ${fmtN(fx.files)} file${fx.files === 1 ? '' : 's'} left` : `${left} of ${e.need} hits left`, mid(), y + 30, C.muted, `11px ${FM}`, 'center', 3);
    haloText(trunc(fx.t, Math.floor((span() - 24) / 7.4)), mid(), H - 14, C.ink, `600 12px ${FM}`, 'center', 4);
    if (D.combo >= 2) {
      const pop = 1 + D.comboPop * 1.4;
      ctx.save(); ctx.translate(mid(), 104); ctx.scale(pop, pop);
      haloText(`${D.combo} HIT COMBO`, 0, 0, col, `700 24px ${FD}`, 'center', 5);
      ctx.restore();
    }
    const B = G.banner;
    if (B) {
      const t = B.t, slide = t < .35 ? 1 - Math.pow(1 - t / .35, 3) : t > 1.8 ? 1 - (t - 1.8) / .4 : 1;
      const bw = Math.min(span() - 20, 420), bh = 64, by = 128, x0 = mid() - bw / 2;
      ctx.save(); ctx.globalAlpha = clamp(slide, 0, 1);
      ctx.translate(0, by); ctx.rotate(-.02);
      ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      const bx = lerp(-E.W, x0, slide);
      ctx.fillRect(bx, 0, bw, bh); ctx.strokeRect(bx, 0, bw, bh);
      ctx.fillStyle = col; ctx.fillRect(bx, 0, 8, bh);
      ctx.font = `700 ${fitSize(B.hero, bw * .32, 32, FD)}px ${FD}`; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(B.hero, bx + 18, 42);
      ctx.font = `700 22px ${FD}`; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.fillText('vs', bx + bw * .4, 40);
      ctx.font = `700 ${fitSize(fixTag(fx), bw * .5, 24, FM)}px ${FM}`; ctx.fillStyle = C.bug; ctx.textAlign = 'left'; ctx.fillText(fixTag(fx), bx + bw * .47, 30);
      ctx.font = `11px ${FM}`; ctx.fillStyle = C.muted; ctx.fillText(trunc(`${fixKind(fx)} · ${ETYPES[e.type].name} · ${fmtDate(fx.d)}`, Math.floor((bw * .5) / 6.8)), bx + bw * .47, 50);
      ctx.restore();
    }
  }
  function drawStamp() {
    const s = G.stamp; if (!s) return;
    const k = clamp(s.t / .18, 0, 1), sc = lerp(2.4, 1, k * k);
    ctx.save(); ctx.translate(mid(), 122); ctx.rotate(-.08); ctx.scale(sc, sc); ctx.globalAlpha = Math.min(1, k * 1.5) * (s.t > 1.9 ? clamp(1 - (s.t - 1.9) * 3, 0, 1) : 1);
    const size = fitSize(s.text, span() * .8, 54, FD);
    ctx.font = `700 ${size}px ${FD}`; const w = ctx.measureText(s.text).width + 30;
    ctx.strokeStyle = s.col; ctx.lineWidth = 4; ctx.strokeRect(-w / 2, -size * .78, w, size * 1.02);
    ctx.fillStyle = s.col; ctx.textAlign = 'center'; ctx.fillText(s.text, 0, size * .1);
    ctx.font = `600 12px ${FM}`; ctx.fillText(s.sub, 0, size * .55 + 6);
    ctx.restore();
  }
  function drawBossBar() {
    const B = G.boss; if (!B) return;
    const w = Math.min(span() * .55, 240), x = mid() - w / 2, y = 40;
    haloText('Tech Debt', mid(), y - 8, C.bug, `700 18px ${FD}`, 'center', 4);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.fillStyle = C.paper; ctx.fillRect(x, y, w, 14); ctx.strokeRect(x, y, w, 14);
    ctx.fillStyle = C.bug; ctx.fillRect(x + 2, y + 2, (w - 4) * clamp(B.hp / 100, 0, 1), 10);
    if (G.finisher && G.finisher.phase === 'cast') {
      haloText(trunc(B.info.s, Math.floor(span() / 8.5)), mid(), 84, C.ink, `600 12px ${FM}`, 'center', 5);
      if (B.info.files != null) haloText(`${fmtN(B.info.files)} files changed`, mid(), 112, E.heroColor(G.finisher.hero.name), `700 26px ${FD}`, 'center', 5);
    }
  }
  /** Fixes waiting to enter, shown as a swarm count at the right edge. */
  function drawSwarm(n) {
    if (!n) return;
    const x = E.W - E.inset.r - 14, y = GY - 120;
    ctx.save(); ctx.globalAlpha = .85;
    for (let k = 0; k < Math.min(6, n); k++) { const a = G.time * 3 + k * 1.3; ctx.fillStyle = C.bug; ctx.beginPath(); ctx.arc(x - 18 + Math.cos(a) * 10, y + 30 + Math.sin(a * 1.3) * 8, 2.4, 0, 7); ctx.fill(); }
    ctx.restore();
    haloText(`+${fmtN(n)}`, x, y, C.bug, `700 20px ${FD}`, 'right', 4);
    haloText('fixes waiting', x, y + 14, C.muted, `10px ${FM}`, 'right', 3);
  }

  return { worldTransform, screenTransform, haloText, drawPaper, drawGrid, drawGround, drawFigure, drawEnemy, drawBoss, drawBeam, drawOrb, drawBolt, drawFlag, drawBot, drawFx, drawParts, highlight, fitSize, drawCard, drawDuelHud, drawStamp, drawBossBar, drawSwarm };
}
