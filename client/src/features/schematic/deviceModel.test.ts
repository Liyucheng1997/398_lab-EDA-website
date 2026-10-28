import { describe, expect, it } from 'vitest';
import type { PlacementInfo } from '@webeda/shared';
import {
  buildDeviceModel,
  categoryOf,
  hitTile,
  parseColor,
  slotGrid,
  slotRect,
  TILE_DSP,
  TILE_EMPTY,
  TILE_IO,
  TILE_LOGIC,
  TILE_RAM,
  tileRow,
  withAlpha,
} from './deviceModel';

function placement(over: Partial<PlacementInfo> = {}): PlacementInfo {
  return { device: 'ice40-hx1k-tq144', width: 14, height: 18, cells: [], ...over };
}

describe('buildDeviceModel', () => {
  it('classifies IO ring, corners, RAM columns and logic tiles (hx1k hints)', () => {
    const m = buildDeviceModel(placement());
    const k = (x: number, y: number) => m.kinds[y * m.width + x];
    expect(k(0, 0)).toBe(TILE_EMPTY);
    expect(k(13, 17)).toBe(TILE_EMPTY);
    expect(k(0, 5)).toBe(TILE_IO);
    expect(k(5, 0)).toBe(TILE_IO);
    expect(k(3, 5)).toBe(TILE_RAM);
    expect(k(10, 9)).toBe(TILE_RAM);
    expect(k(5, 5)).toBe(TILE_LOGIC);
    expect(m.originBottom).toBe(true);
    expect(m.tileTotals[TILE_EMPTY]).toBe(4);
    expect(m.tileTotals[TILE_IO]).toBe(2 * 12 + 2 * 16);
    expect(m.tileTotals[TILE_RAM]).toBe(32);
    expect(m.tileTotals[TILE_LOGIC]).toBe(12 * 16 - 32);
  });

  it('infers RAM/DSP columns from cells on unknown devices and counts usage', () => {
    const m = buildDeviceModel({
      device: 'ecp5-25k-cabga256',
      width: 10,
      height: 8,
      cells: [
        { name: 'ram0', type: 'RAM', x: 4, y: 2, z: 0 },
        { name: 'mul', type: 'DSP', x: 7, y: 3, z: 0 },
        { name: 'a', type: 'SLICE', x: 2, y: 2, z: 0 },
        { name: 'b', type: 'SLICE', x: 2, y: 2, z: 3 },
        { name: 'c', type: 'slice', x: 5, y: 5, z: 1 },
        { name: 'pin', type: 'IO', x: 0, y: 3, z: 1 },
        { name: 'bad', type: 'SLICE', x: 99, y: 2, z: 0 },
      ],
    });
    const k = (x: number, y: number) => m.kinds[y * m.width + x];
    expect(m.originBottom).toBe(false);
    expect(k(4, 6)).toBe(TILE_RAM); // 同列推断
    expect(k(7, 1)).toBe(TILE_DSP);
    expect(k(2, 2)).toBe(TILE_LOGIC);
    expect(m.outOfRange).toBe(1);
    expect(m.totalCells).toBe(6);
    expect(m.tiles.get(2 * 10 + 2)!.cells.map((c) => c.name)).toEqual(['a', 'b']);
    expect(m.tiles.get(2 * 10 + 2)!.slots).toBe(4);
    expect(m.tileUsed[TILE_LOGIC]).toBe(2);
    expect(m.tileUsed[TILE_IO]).toBe(1);
    expect(m.typeCounts.map((t) => [t.type, t.count])).toEqual([
      ['SLICE', 3],
      ['IO', 1],
      ['RAM', 1],
      ['DSP', 1],
    ]);
  });

  it('data overrides hints (a logic cell in a hinted RAM column)', () => {
    const m = buildDeviceModel(placement({ cells: [{ name: 'lc', type: 'LC', x: 3, y: 4, z: 7 }] }));
    expect(m.kinds[4 * 14 + 3]).toBe(TILE_LOGIC);
    expect(m.tiles.get(4 * 14 + 3)!.slots).toBe(8);
  });

  it('grows slots when z exceeds the default', () => {
    const m = buildDeviceModel(placement({ cells: [{ name: 'x', type: 'LC', x: 5, y: 5, z: 11 }] }));
    expect(m.slotsByType.get('LC')).toBe(12);
  });

  it('infers grid size when width/height are missing and tolerates garbage', () => {
    const m = buildDeviceModel({
      device: 'ice40-up5k-sg48',
      width: 0,
      height: Number.NaN,
      cells: [
        { name: 'a', type: 'LC', x: 4, y: 6, z: 0 },
        // @ts-expect-error 畸形数据
        { name: 'b', type: 'LC', x: 'q', y: 1, z: 0 },
      ],
    });
    expect(m.width).toBe(5);
    expect(m.height).toBe(7);
    expect(m.totalCells).toBe(1);
    expect(m.outOfRange).toBe(1);
  });

  it('handles empty placements', () => {
    const m = buildDeviceModel({ device: 'ice40-hx1k-tq144', width: 1, height: 1, cells: [] });
    expect(m.totalCells).toBe(0);
    expect(m.kinds[0]).toBe(TILE_LOGIC);
  });
});

describe('coordinates', () => {
  it('maps rows with bottom origin (iCE40) and hit-tests back', () => {
    const m = { width: 14, height: 18, originBottom: true };
    expect(tileRow(m, 0)).toBe(17);
    expect(hitTile(m, 3.5, 17.2)).toEqual({ x: 3, y: 0 });
    expect(hitTile(m, -0.1, 3)).toBeNull();
    expect(hitTile(m, 14, 3)).toBeNull();
  });
  it('maps rows with top origin (ECP5)', () => {
    const m = { width: 10, height: 10, originBottom: false };
    expect(tileRow(m, 2)).toBe(2);
    expect(hitTile(m, 1.2, 2.9)).toEqual({ x: 1, y: 2 });
  });
});

describe('slots', () => {
  it('lays out common BEL counts', () => {
    expect(slotGrid(1)).toEqual({ cols: 1, rows: 1 });
    expect(slotGrid(2)).toEqual({ cols: 2, rows: 1 });
    expect(slotGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(slotGrid(8)).toEqual({ cols: 2, rows: 4 });
    expect(slotGrid(12)).toEqual({ cols: 4, rows: 4 });
    expect(slotGrid(30)).toEqual({ cols: 6, rows: 5 });
  });
  it('keeps every slot inside the tile and non-overlapping', () => {
    const rects = Array.from({ length: 8 }, (_, z) => slotRect(z, 8, 40));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.size).toBeLessThanOrEqual(40);
      expect(r.y + r.size).toBeLessThanOrEqual(40);
    }
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = a.x < b.x + b.size && b.x < a.x + a.size && a.y < b.y + b.size && b.y < a.y + a.size;
        expect(overlap).toBe(false);
      }
  });
  it('wraps out-of-range z', () => {
    expect(slotRect(9, 8, 40)).toEqual(slotRect(1, 8, 40));
  });
});

describe('colors', () => {
  it('parses css colors', () => {
    expect(parseColor('#0071e3')).toEqual([0, 113, 227, 1]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('rgba(10, 132, 255, 0.16)')).toEqual([10, 132, 255, 0.16]);
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 0.5]);
    expect(parseColor('papayawhip')).toBeNull();
  });
  it('applies alpha', () => {
    expect(withAlpha('#1d1d1f', 0.5)).toBe('rgba(29, 29, 31, 0.5)');
    expect(withAlpha('rgba(10,132,255,0.5)', 0.5)).toBe('rgba(10, 132, 255, 0.25)');
    expect(withAlpha('red', 0.5)).toBe('red');
  });
  it('categorizes cell types', () => {
    expect(categoryOf('LC')).toBe('logic');
    expect(categoryOf('slice')).toBe('logic');
    expect(categoryOf('IO')).toBe('IO');
    expect(categoryOf('GB')).toBe('GB');
    expect(categoryOf('WEIRD')).toBe('OTHER');
  });
});
