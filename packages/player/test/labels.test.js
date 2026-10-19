import { describe, it, expect } from 'vitest';
import { fixLabel } from '../src/util.js';

const fx = (o) => ({ sha: '8c739b4aa', pr: null, issues: [], t: 'crash when todo content is empty', s: 'fix: crash when todo content is empty', sc: null, ...o });

describe('fixLabel', () => {
  it('names a fix by what it fixed, not by its hash', () => {
    expect(fixLabel(fx())).toBe('crash when todo content is…');
    expect(fixLabel(fx(), 60)).toBe('crash when todo content is empty');
    expect(fixLabel(fx())).not.toMatch(/8c739b4/);
  });
  it('puts the code area first when the commit names one', () => {
    expect(fixLabel(fx({ sc: 'tui', t: 'cursor jumps' }))).toBe('tui · cursor jumps');
    expect(fixLabel(fx({ sc: 'tui', t: 'tui cursor jumps' }))).toBe('tui cursor jumps');
  });
  it('keeps issue and pull request numbers in front', () => {
    expect(fixLabel(fx({ issues: [{ number: 51, title: null }] }), 60)).toBe('#51 crash when todo content is empty');
    expect(fixLabel(fx({ pr: 12, t: 'cursor jumps' }))).toBe('#12 cursor jumps');
  });
  it('falls back to the short hash only when there is no text', () => {
    expect(fixLabel(fx({ t: '', s: '' }))).toBe('8c739b4');
  });
});
