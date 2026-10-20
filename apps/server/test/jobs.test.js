import { describe, it, expect } from 'vitest';
import { pickNext } from '../src/jobs.js';

const build = (id) => ({ id, kind: 'build' });
const col = (id, collectionId) => ({ id, kind: 'collection', collectionId });
const MIN = 60000;

describe('pickNext: which job runs next', () => {
  it('runs jobs in order normally', () => {
    expect(pickNext([build('a'), build('b'), col('c', 'x')], { now: 0, stale: new Map() })).toBe(0);
  });
  it('lets a collection rebuild jump ahead once 25 stories finished since its last build', () => {
    const stale = new Map([['x', { changed: 25, since: 0 }]]);
    expect(pickNext([build('a'), build('b'), col('c', 'x')], { now: MIN, stale })).toBe(2);
    stale.set('x', { changed: 24, since: 0 });
    expect(pickNext([build('a'), build('b'), col('c', 'x')], { now: MIN, stale })).toBe(0);
  });
  it('or once three minutes passed since its last build with something new', () => {
    const stale = new Map([['x', { changed: 1, since: 0 }]]);
    expect(pickNext([build('a'), col('c', 'x')], { now: 3 * MIN, stale })).toBe(1);
    expect(pickNext([build('a'), col('c', 'x')], { now: 2 * MIN, stale })).toBe(0);
  });
  it('never jumps for a collection with nothing new', () => {
    expect(pickNext([build('a'), col('c', 'x')], { now: 60 * MIN, stale: new Map() })).toBe(0);
  });
});
