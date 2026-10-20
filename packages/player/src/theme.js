// Colors come from CSS custom properties on the canvas (--paper, --ink,
// --bug, --orb, --c1…--c11 and friends), so the host's light and dark themes
// apply. Missing properties fall back to DEFAULT_THEME.

export const DEFAULT_THEME = {
  paper: '#f3f5f2', 'paper-2': '#e8ede9', grid: '#dbe4e8', rule: '#c5d0d6', ink: '#1c2433', muted: '#5b6676',
  bug: '#c62f3b', gold: '#a46f00', orb: '#e2a400', hl: '#ffe66d', 'hl-ink': '#1c2433',
  c1: '#2457c5', c2: '#23873b', c3: '#7a3fd1', c4: '#cf5f10', c5: '#b8277a', c6: '#687a10',
  c7: '#0a7ea4', c8: '#8a5a2b', c9: '#a07400', c10: '#536173', c11: '#0f7f74',
};

export const HERO_COLORS = 11;

/** Fill `C` in place from the canvas's computed style, so modules holding C see the change. */
export function readTheme(canvas, C) {
  const cs = getComputedStyle(canvas);
  const g = (n) => cs.getPropertyValue('--' + n).trim() || DEFAULT_THEME[n];
  Object.assign(C, {
    paper: g('paper'), paper2: g('paper-2'), grid: g('grid'), rule: g('rule'), ink: g('ink'), muted: g('muted'),
    bug: g('bug'), gold: g('gold'), orb: g('orb'), hl: g('hl'), hlInk: g('hl-ink'), hero: [],
  });
  for (let i = 1; i <= HERO_COLORS; i++) C.hero.push(g('c' + i));
  return C;
}

export const FD = '"Gaegu", "Comic Sans MS", "Chalkboard SE", cursive';
export const FM = '"Spline Sans Mono", ui-monospace, Menlo, monospace';
