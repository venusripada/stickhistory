// Small helpers shared by the player modules.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const fmtN = (n) => Number(n).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${MON[+m - 1]} ${+dd}, ${y}`; };
export const fmtMonth = (d) => { const [y, m] = d.split('-'); return `${MON[+m - 1]} ${y}`; };
export const range = (a, b) => { const x = fmtMonth(a), y = fmtMonth(b); return x === y ? x : `${x} – ${y}`; };
export const trunc = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
export const fixTag = (fx) => (fx.issues && fx.issues.length ? `#${fx.issues[0].number}` : fx.pr ? `#${fx.pr}` : String(fx.sha || '').slice(0, 7));
export const fixKind = (fx) => (fx.issues && fx.issues.length ? 'Issue' : fx.pr ? 'Pull request' : 'Commit');
/**
 * What a fix was, in words: its short title, led by the code area when the commit names one
 * ("tui · cursor jumps") and by its issue or pull request number when it has one ("#51 crash on start").
 * The short hash is only the last resort.
 */
export function fixLabel(fx, max = 28) {
  const title = String(fx.t || fx.s || '').trim();
  if (!title) return String(fx.sha || '').slice(0, 7);
  const num = fx.issues && fx.issues.length ? fx.issues[0].number : fx.pr;
  const scope = !num && fx.sc && !title.toLowerCase().startsWith(String(fx.sc).toLowerCase()) ? `${fx.sc} · ` : '';
  const text = (num ? `#${num} ` : scope) + title;
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
export const filesLabel = (n) => (n == null ? '' : `${fmtN(n)} file${n === 1 ? '' : 's'}`);

export const ETYPES = {
  gremlin: { name: 'Gremlin', hover: 0, speed: 70, launch: true },
  beetle:  { name: 'Perf Beetle', hover: 0, speed: 40, launch: false },
  crawler: { name: 'Logic Crawler', hover: 0, speed: 55, launch: true },
  wraith:  { name: 'Path Wraith', hover: 24, speed: 50, launch: true },
  moth:    { name: 'Glitch Moth', hover: 34, speed: 62, launch: true },
  bomb:    { name: 'Crash Bomb', hover: 0, speed: 48, launch: true },
};
export const ENEMY_NAMES = Object.fromEntries(Object.entries(ETYPES).map(([k, v]) => [k, v.name]));

/** World height and ground line; the world is H tall and as wide as the frame allows. */
export const H = 400, GY = 332;
