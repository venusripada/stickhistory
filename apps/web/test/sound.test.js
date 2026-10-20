import { describe, it, expect } from 'vitest';
import { createLimiter, cueFor } from '../src/sound.js';

describe('sound limiter: a fight stays quiet even when it gets busy', () => {
  it('lets a sound repeat only after its own gap', () => {
    const lim = createLimiter({ gaps: { hit: 100 }, perSecond: 50 });
    expect(lim.allow('hit', 0)).toBe(true);
    expect(lim.allow('hit', 50)).toBe(false);
    expect(lim.allow('hit', 100)).toBe(true);
  });
  it('lets different sounds overlap', () => {
    const lim = createLimiter({ gaps: { hit: 100, big: 100 }, perSecond: 50 });
    expect(lim.allow('hit', 0)).toBe(true);
    expect(lim.allow('big', 1)).toBe(true);
  });
  it('caps all sounds together per second', () => {
    const lim = createLimiter({ gaps: {}, perSecond: 3 });
    const t = [0, 10, 20, 30, 40].map((ms) => lim.allow('hit', ms));
    expect(t).toEqual([true, true, true, false, false]);
    expect(lim.allow('hit', 1001)).toBe(true);
  });
});

describe('which story moments make a sound', () => {
  it('maps the big moments, and stays silent for the rest', () => {
    expect(cueFor({ kind: 'boss' })).toBe('boss');
    expect(cueFor({ kind: 'boss-open' })).toBe('shield');
    expect(cueFor({ kind: 'boss-down' })).toBe('win');
    expect(cueFor({ kind: 'duel-won' })).toBe('win');
    expect(cueFor({ kind: 'release' })).toBe('release');
    expect(cueFor({ kind: 'chapter' })).toBe(null);
    expect(cueFor({ kind: 'duel' })).toBe(null);
  });
});
