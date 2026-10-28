import { describe, expect, it } from 'vitest';
import { fitText } from './render';

describe('fitText', () => {
  it('keeps text that fits', () => {
    expect(fitText('A5', 20, 7)).toBe('A5');
  });
  it('truncates with ellipsis', () => {
    expect(fitText('DEADBEEF', 35, 7)).toBe('DEAD…');
    expect(fitText('DEADBEEF', 14, 7)).toBe('D…');
    expect(fitText('DEADBEEF', 7, 7)).toBe('…');
    expect(fitText('DEADBEEF', 6, 7)).toBe('');
  });
  it('handles degenerate char width', () => {
    expect(fitText('abc', 1, 0)).toBe('abc');
  });
});
