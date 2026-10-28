import { describe, expect, it } from 'vitest';
import {
  cellNameFromId,
  centerOn,
  exportCanvasSize,
  fitTransform,
  matchesQuery,
  nearestSegment,
  netClassOf,
  netWidth,
  safeFileName,
  toContent,
  wheelZoomFactor,
  zoomAt,
} from './geometry';

describe('fitTransform', () => {
  it('centers and scales down large content', () => {
    const t = fitTransform(2000, 1000, 1048, 548, 24);
    expect(t.k).toBeCloseTo(0.5);
    expect(t.x).toBeCloseTo((1048 - 1000) / 2);
    expect(t.y).toBeCloseTo((548 - 500) / 2);
  });
  it('never enlarges past maxK', () => {
    const t = fitTransform(100, 50, 1000, 1000, 0, 0.01, 1);
    expect(t.k).toBe(1);
    expect(t.x).toBe(450);
  });
  it('clamps to minK for gigantic content', () => {
    expect(fitTransform(1e7, 1e7, 100, 100, 0, 0.02).k).toBe(0.02);
  });
  it('returns identity for degenerate sizes', () => {
    expect(fitTransform(0, 10, 100, 100)).toEqual({ x: 0, y: 0, k: 1 });
    expect(fitTransform(10, 10, 0, 0)).toEqual({ x: 0, y: 0, k: 1 });
  });
});

describe('zoomAt / toContent / centerOn', () => {
  it('keeps the anchor point fixed while zooming', () => {
    const t = { x: 30, y: -20, k: 0.7 };
    const before = toContent(t, 200, 150);
    const z = zoomAt(t, 200, 150, 2.3);
    const after = toContent(z, 200, 150);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(z.k).toBe(2.3);
  });
  it('centers a content point', () => {
    const t = centerOn({ x: 0, y: 0, k: 2 }, 100, 50, 800, 600);
    expect(t.x + 100 * 2).toBe(400);
    expect(t.y + 50 * 2).toBe(300);
  });
  it('wheel factor is symmetric and bounded', () => {
    expect(wheelZoomFactor(100) * wheelZoomFactor(-100)).toBeCloseTo(1);
    expect(wheelZoomFactor(-1e9)).toBeCloseTo(Math.exp(0.6));
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48, 0));
  });
});

describe('nearestSegment', () => {
  const segs = [
    { x1: 0, y1: 0, x2: 100, y2: 0 },
    { x1: 50, y1: -50, x2: 50, y2: 50 },
    { x1: 200, y1: 200, x2: 200, y2: 200 },
  ];
  it('finds the closest segment within tolerance', () => {
    expect(nearestSegment(segs, 20, 2, 4)).toBe(0);
    expect(nearestSegment(segs, 52, 30, 4)).toBe(1);
    expect(nearestSegment(segs, 201, 201, 4)).toBe(2);
  });
  it('returns -1 when nothing is close', () => {
    expect(nearestSegment(segs, 20, 10, 4)).toBe(-1);
    expect(nearestSegment([], 0, 0, 4)).toBe(-1);
  });
});

describe('netlistsvg naming helpers', () => {
  it('extracts net class names', () => {
    expect(netClassOf('net_8,9,10,11,12')).toBe('net_8,9,10,11,12');
    expect(netClassOf('foo net_4 width_1')).toBe('net_4');
    expect(netClassOf('cell_x')).toBeNull();
    expect(netClassOf(null)).toBeNull();
    expect(netClassOf('net_')).toBeNull();
  });
  it('computes bus width', () => {
    expect(netWidth('net_4')).toBe(1);
    expect(netWidth('net_8,9,10,11,12')).toBe(5);
    expect(netWidth('net_,4,5,')).toBe(2);
  });
  it('extracts cell names', () => {
    expect(cellNameFromId('cell_u_add')).toBe('u_add');
    expect(cellNameFromId('port_u_add~a')).toBeNull();
    expect(cellNameFromId(null)).toBeNull();
  });
  it('matches labels case-insensitively and ignores empty queries', () => {
    expect(matchesQuery('U_Add', 'add')).toBe(true);
    expect(matchesQuery('clk', '  ')).toBe(false);
    expect(matchesQuery('rst', 'clk')).toBe(false);
  });
});

describe('export helpers', () => {
  it('sanitizes file names', () => {
    expect(safeFileName('top/a:b*c?')).toBe('top_a_b_c_');
    expect(safeFileName('  ..  ')).toBe('schematic');
    expect(safeFileName('', 'x')).toBe('x');
  });
  it('limits canvas size', () => {
    expect(exportCanvasSize(580, 296)).toEqual({ width: 1160, height: 592, scale: 2 });
    const big = exportCanvasSize(20000, 1000);
    expect(big.width).toBeLessThanOrEqual(16384);
    const huge = exportCanvasSize(12000, 12000);
    expect(huge.width * huge.height).toBeLessThanOrEqual(120_000_000);
  });
});
