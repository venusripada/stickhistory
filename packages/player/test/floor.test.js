import { describe, it, expect } from 'vitest';
import { FLOOR, footY, scaleAt, slotFor, inReach, depthToward } from '../src/floor.js';
import { GY } from '../src/util.js';

describe('the floor', () => {
  it('runs from a back edge to a front edge, and the old ground line sits inside it', () => {
    expect(footY(0)).toBe(FLOOR.back);
    expect(footY(1)).toBe(FLOOR.front);
    expect(FLOOR.back).toBeLessThan(GY);
    expect(FLOOR.front).toBeGreaterThan(GY);
    expect(FLOOR.front).toBeLessThanOrEqual(398);
  });
  it('draws things further back smaller', () => {
    expect(scaleAt(0)).toBeLessThan(scaleAt(0.5));
    expect(scaleAt(0.5)).toBeLessThan(scaleAt(1));
    expect(scaleAt(1)).toBeCloseTo(1.05, 2);
  });
  it('gives each hero their own patch, apart from the others', () => {
    const W = 711;
    const slots = Array.from({ length: 8 }, (_, k) => slotFor(k, W));
    for (const s of slots) { expect(s.x).toBeGreaterThan(30); expect(s.x).toBeLessThan(W * 0.75); expect(s.d).toBeGreaterThanOrEqual(0.1); expect(s.d).toBeLessThanOrEqual(0.9); }
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      const a = slots[i], b = slots[j];
      expect(Math.abs(a.x - b.x) > 60 || Math.abs(a.d - b.d) > 0.25).toBe(true);
    }
  });
  it('lets a hit land only at about the same depth', () => {
    expect(inReach({ x: 100, d: 0.5 }, { x: 140, d: 0.55 }, 50)).toBe(true);
    expect(inReach({ x: 100, d: 0.5 }, { x: 140, d: 0.8 }, 50)).toBe(false);
    expect(inReach({ x: 100, d: 0.5 }, { x: 200, d: 0.5 }, 50)).toBe(false);
  });
  it('moves toward a depth without overshooting', () => {
    expect(depthToward(0.2, 0.8, 0.1)).toBeCloseTo(0.3, 5);
    expect(depthToward(0.79, 0.8, 0.1)).toBe(0.8);
    expect(depthToward(0.8, 0.2, 0.1)).toBeCloseTo(0.7, 5);
  });
});
