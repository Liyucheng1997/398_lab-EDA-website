import { describe, expect, it } from 'vitest';
import { computeTicks, formatTime, fsPerUnit, niceStep, tickLabel } from './ticks';

describe('niceStep', () => {
  it('rounds up to 1/2/5 × 10^k', () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.2)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBeCloseTo(0.05);
    expect(niceStep(20)).toBe(20);
    expect(niceStep(450)).toBe(500);
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe('fsPerUnit', () => {
  it('converts timescales', () => {
    expect(fsPerUnit({ magnitude: 1, unit: 'ns' })).toBe(1e6);
    expect(fsPerUnit({ magnitude: 10, unit: 'ps' })).toBe(1e4);
    expect(fsPerUnit({ magnitude: 100, unit: 'fs' })).toBe(100);
  });
});

describe('computeTicks', () => {
  it('picks steps with at least minPx spacing', () => {
    const fs = 1e6; // 1 ns
    const t = computeTicks(0, 1000, 1000, fs, 90);
    expect(t.step).toBe(100);
    expect(t.unit).toBe('ns');
    expect(t.majors[0]).toBe(0);
    expect(t.majors[t.majors.length - 1]).toBe(1000);
    expect(t.minor).toBe(20);
    expect(tickLabel(500, t, fs)).toBe('500 ns');
  });
  it('switches unit for big steps', () => {
    const fs = 1e3; // 1 ps
    const t = computeTicks(0, 5_000_000, 1000, fs, 90);
    expect(t.step).toBe(500_000);
    expect(t.unit).toBe('ns');
    expect(tickLabel(1_000_000, t, fs)).toBe('1000 ns');
  });
  it('handles offset starts and 2-mantissa minors', () => {
    const t = computeTicks(13, 57, 440, 1e6, 90);
    expect(t.step).toBe(10);
    expect(t.majors).toEqual([20, 30, 40, 50]);
    const t2 = computeTicks(0, 200, 1000, 1e6, 90);
    expect(t2.step).toBe(20);
    expect(t2.minor).toBe(5);
  });
  it('allows sub-unit steps with decimals', () => {
    const t = computeTicks(0, 1, 1000, 1, 90);
    expect(t.step).toBeCloseTo(0.1);
    expect(t.decimals).toBe(1);
    expect(tickLabel(0.3, t, 1)).toBe('0.3 fs');
  });
  it('guards degenerate inputs', () => {
    const t = computeTicks(5, 5, 0, 1e6);
    expect(t.majors.length).toBeLessThanOrEqual(2000);
    expect(Number.isFinite(t.step)).toBe(true);
  });
});

describe('formatTime', () => {
  it('formats with timescale', () => {
    expect(formatTime(125, 1e6)).toBe('125 ns');
    expect(formatTime(40, 1e6)).toBe('40 ns');
    expect(formatTime(1500, 1e3)).toBe('1.5 ns');
    expect(formatTime(3, 1e7)).toBe('30 ns');
    expect(formatTime(0, 1e15)).toBe('0 s');
    expect(formatTime(0, 1e3)).toBe('0 ps');
  });
});
