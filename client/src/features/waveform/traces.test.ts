import { describe, expect, it } from 'vitest';
import { loadPersisted, sanitizePersisted, savePersisted } from './persist';
import {
  ANALOG_H,
  ROW_H,
  autoSignals,
  bitIndex,
  buildPathIndex,
  buildRows,
  insertionTraceIndex,
  moveTraces,
  resolvePath,
  rowIndexAt,
  visibleRange,
  type Trace,
} from './traces';
import { parseVcd } from './vcd';

const data = parseVcd(
  [
    '$timescale 1ns $end',
    '$scope module tb $end',
    '$var reg 1 ! clk $end',
    '$var wire 4 " q [3:0] $end',
    '$var real 1 # v $end',
    '$scope module dut $end',
    '$var wire 4 $ q [3:0] $end',
    '$var wire 3 % rev [0:2] $end',
    '$upscope $end',
    '$upscope $end',
    '$enddefinitions $end',
    '#0 0! b1010 " r0.5 # b1 $ b101 %',
    '#5 1!',
    '#10',
    '',
  ].join('\n'),
);
const idx = buildPathIndex(data);
let uid = 0;
const tr = (path: string, extra: Partial<Trace> = {}): Trace => ({ uid: ++uid, path, radix: 'hex', analog: false, expanded: false, ...extra });

describe('resolvePath / autoSignals', () => {
  it('resolves exact, ranged and case-insensitive names', () => {
    expect(resolvePath(idx, data, 'tb.clk')).toBe(0);
    expect(resolvePath(idx, data, 'tb.q[3:0]')).toBe(1);
    expect(resolvePath(idx, data, 'TB.DUT.Q')).toBe(3);
    expect(resolvePath(idx, data, 'tb.nope')).toBeUndefined();
  });
  it('picks first scope with signals', () => {
    expect(autoSignals(data)).toEqual([0, 1, 2]);
    expect(autoSignals(data, 2)).toEqual([0, 1]);
  });
});

describe('bitIndex', () => {
  it('maps MSB-first bit position to Verilog index', () => {
    expect(bitIndex(data.vars[1], 0)).toBe(3);
    expect(bitIndex(data.vars[1], 3)).toBe(0);
    expect(bitIndex(data.vars[4], 0)).toBe(0); // [0:2]
    expect(bitIndex(data.vars[4], 2)).toBe(2);
  });
});

describe('buildRows', () => {
  it('lays out rows with expansion, analog heights and disambiguated labels', () => {
    const traces = [tr('tb.clk'), tr('tb.q', { expanded: true }), tr('tb.v', { analog: true }), tr('tb.dut.q'), tr('missing')];
    const { rows, total } = buildRows(data, idx, traces);
    expect(rows.map((r) => r.label)).toEqual(['clk', 'tb.q[3:0]', 'q[3]', 'q[2]', 'q[1]', 'q[0]', 'v', 'dut.q[3:0]']);
    expect(rows[0].mode).toBe('bit');
    expect(rows[1].mode).toBe('bus');
    expect(rows[2].mode).toBe('bit');
    expect(rows[6].mode).toBe('analog');
    expect(rows[6].height).toBe(ANALOG_H);
    expect(total).toBe(ROW_H * 7 + ANALOG_H);
    expect(Array.from(rows[2].wave.bits!)).toEqual([1]);
    expect(Array.from(rows[3].wave.bits!)).toEqual([0]);
    expect(rowIndexAt(rows, 0)).toBe(0);
    expect(rowIndexAt(rows, ROW_H * 6 + 10)).toBe(6);
    expect(rowIndexAt(rows, total + 1)).toBe(-1);
    expect(visibleRange(rows, ROW_H * 2, ROW_H * 2, 0)).toEqual([2, 4]);
    expect(visibleRange([], 0, 100)).toEqual([0, -1]);
  });
});

describe('moveTraces / insertionTraceIndex', () => {
  const a = tr('tb.clk');
  const b = tr('tb.q');
  const c = tr('tb.v');
  const d = tr('tb.dut.q');
  const list = [a, b, c, d];
  it('moves selection preserving order', () => {
    expect(moveTraces(list, new Set([d.uid]), 0).map((t) => t.path)).toEqual(['tb.dut.q', 'tb.clk', 'tb.q', 'tb.v']);
    expect(moveTraces(list, new Set([a.uid, c.uid]), 4).map((t) => t.path)).toEqual(['tb.q', 'tb.dut.q', 'tb.clk', 'tb.v']);
    expect(moveTraces(list, new Set([a.uid]), 2).map((t) => t.path)).toEqual(['tb.q', 'tb.clk', 'tb.v', 'tb.dut.q']);
    expect(moveTraces(list, new Set([999]), 0)).toBe(list);
  });
  it('computes insertion index from y', () => {
    const { rows } = buildRows(data, idx, list);
    expect(insertionTraceIndex(rows, list, 2)).toBe(0);
    expect(insertionTraceIndex(rows, list, ROW_H - 2)).toBe(1);
    expect(insertionTraceIndex(rows, list, 10_000)).toBe(4);
    expect(insertionTraceIndex(rows, list, -5)).toBe(0);
    expect(insertionTraceIndex([], [], 10)).toBe(0);
  });
});

describe('persist', () => {
  it('sanitizes stored state', () => {
    expect(sanitizePersisted(null)).toBeNull();
    expect(sanitizePersisted({ traces: 'x' })).toBeNull();
    const s = sanitizePersisted({
      traces: [{ path: 'tb.q', radix: 'sdec', analog: true }, { path: '' }, { radix: 'hex' }, { path: 'tb.x', radix: 'bogus' }],
      view: { start: 10, end: 5 },
      defaultRadix: 'bin',
    });
    expect(s?.traces).toEqual([
      { path: 'tb.q', radix: 'sdec', analog: true, expanded: false },
      { path: 'tb.x', radix: 'hex', analog: false, expanded: false },
    ]);
    expect(s?.view).toBeUndefined();
    expect(s?.defaultRadix).toBe('bin');
    expect(sanitizePersisted({ traces: [], view: { start: 0, end: 5, fit: true } })?.view).toEqual({ start: 0, end: 5, fit: true });
  });
  it('load/save never throw without localStorage', () => {
    expect(loadPersisted('k')).toBeNull();
    expect(loadPersisted(undefined)).toBeNull();
    expect(() => savePersisted('k', { v: 1, traces: [] })).not.toThrow();
  });
});
