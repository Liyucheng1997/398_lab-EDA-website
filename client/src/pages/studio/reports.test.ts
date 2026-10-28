import { describe, expect, it } from 'vitest';
import type { ImplementResult, RunRecord, SynthesizeResult } from '@webeda/shared';
import {
  formatDuration,
  keyRows,
  rowsFromSummary,
  formatMHz,
  formatPercent,
  formatRelative,
  latestRun,
  meterClass,
  meterWidth,
  nextRunName,
  pickResource,
  sortUtilRows,
  sortedCells,
  summarizeResult,
  timingSummary,
  utilPercent,
} from './reports';

describe('utilization percent', () => {
  it('computes and formats', () => {
    expect(utilPercent(50, 200)).toBe(25);
    expect(utilPercent(5, null)).toBeNull();
    expect(utilPercent(5, 0)).toBeNull();
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.04)).toBe('<0.1%');
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatPercent(150.4)).toBe('150%');
  });

  it('classifies meters', () => {
    expect(meterClass(null)).toBe('');
    expect(meterClass(80)).toBe('');
    expect(meterClass(80.1)).toBe('warn');
    expect(meterClass(100)).toBe('warn');
    expect(meterClass(100.5)).toBe('over');
    expect(meterWidth(250)).toBe(100);
    expect(meterWidth(0.2)).toBe(1);
    expect(meterWidth(null)).toBe(0);
  });

  it('picks key resources across families', () => {
    const ice = [
      { resource: 'LC', used: 10, available: 5280 },
      { resource: 'LUT4', used: 8, available: 5280 },
      { resource: 'FF', used: 4, available: 5280 },
      { resource: 'BRAM', used: 1, available: 30 },
      { resource: 'IO', used: 3, available: 39 },
    ];
    expect(pickResource(ice, 'LUT')?.resource).toBe('LUT4');
    expect(pickResource(ice, 'DSP')).toBeNull();
    expect(pickResource([{ resource: 'BSRAM', used: 2, available: 26 }], 'BRAM')?.used).toBe(2);
    expect(pickResource([{ resource: 'LUT6', used: 2, available: 20800 }], 'LUT')?.resource).toBe('LUT6');
    expect(sortUtilRows(ice).map((r) => r.resource)).toEqual(['LUT4', 'FF', 'BRAM', 'IO', 'LC']);
  });

  it('sorts cell counts descending', () => {
    const cells = sortedCells({ target: 'ice40', rows: [], cells: { SB_LUT4: 10, SB_DFF: 3, SB_CARRY: 10 } });
    expect(cells.map((c) => c.type)).toEqual(['SB_CARRY', 'SB_LUT4', 'SB_DFF']);
    expect(sortedCells(undefined)).toEqual([]);
  });
});

const synth: SynthesizeResult = {
  kind: 'synthesize',
  top: 'top',
  diagnostics: [
    { severity: 'warning', message: 'w', tool: 'yosys' },
    { severity: 'info', message: 'i', tool: 'yosys' },
  ],
  artifacts: [],
  durationMs: 1000,
  netlist: 'netlist.json',
  utilization: {
    target: 'ice40',
    rows: [
      { resource: 'LUT4', used: 120, available: 5280 },
      { resource: 'FF', used: 40, available: 5280 },
      { resource: 'IO', used: 5, available: 39 },
    ],
    cells: {},
  },
};

const impl: ImplementResult = {
  kind: 'implement',
  top: 'top',
  device: 'ice40-up5k-sg48',
  diagnostics: [],
  artifacts: [],
  durationMs: 5000,
  utilization: synth.utilization,
  bitstream: 'top.bin',
  stages: [],
  timing: {
    clocks: [
      { clock: 'clk', achievedMHz: 80.123, constraintMHz: 12, slackNs: 70.85, passed: true },
      { clock: 'clk2', achievedMHz: 40, constraintMHz: 50, slackNs: -5, passed: false },
    ],
    criticalPaths: [],
  },
};

describe('timing + summaries', () => {
  it('summarizes the worst clock', () => {
    const t = timingSummary(impl.timing)!;
    expect(t.clock).toBe('clk2');
    expect(t.wns).toBe(-5);
    expect(t.passed).toBe(false);
    expect(timingSummary({ clocks: [], criticalPaths: [] })).toBeNull();
    expect(timingSummary(undefined)).toBeNull();
    expect(formatMHz(80.123)).toBe('80.12 MHz');
    expect(formatMHz(123.45)).toBe('123.5 MHz');
  });

  it('builds run summaries', () => {
    expect(summarizeResult(synth)).toEqual({ errors: 0, warnings: 1, LUT: 120, FF: 40, IO: 5 });
    const s = summarizeResult(impl);
    expect(s.Fmax).toBe(40);
    expect(s.WNS).toBe(-5);
    expect(s.timingMet).toBe(0);
    expect(s.bitstream).toBe('top.bin');
    expect(summarizeResult(null)).toEqual({});
    expect(
      summarizeResult({ kind: 'simulate', exitCode: 0, timedOut: true, diagnostics: [], artifacts: [], durationMs: 1 }),
    ).toEqual({ errors: 0, warnings: 0, exitCode: 0, timedOut: 1 });
  });

  it('names runs and finds the latest', () => {
    const runs: RunRecord[] = [
      { id: 'synth_1', kind: 'synthesize', jobId: 'a', status: 'succeeded', startedAt: '2026-01-01T00:00:00Z' },
      { id: 'synth_3', kind: 'synthesize', jobId: 'b', status: 'failed', startedAt: '2026-01-02T00:00:00Z' },
      { id: 'impl_1', kind: 'implement', jobId: 'c', status: 'succeeded', startedAt: '2026-01-03T00:00:00Z' },
    ];
    expect(nextRunName(runs, 'synthesize')).toBe('synth_4');
    expect(nextRunName(runs, 'implement')).toBe('impl_2');
    expect(nextRunName([], 'simulate')).toBe('sim_1');
    expect(latestRun(runs, 'synthesize')?.id).toBe('synth_3');
    expect(latestRun(runs, 'synthesize', (r) => r.status === 'succeeded')?.id).toBe('synth_1');
    expect(latestRun(runs, 'simulate')).toBeUndefined();
  });
});

describe('time formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(420)).toBe('420 ms');
    expect(formatDuration(4200)).toBe('4.2 s');
    expect(formatDuration(42000)).toBe('42 s');
    expect(formatDuration(125000)).toBe('2:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
  });
  it('formats relative times', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(formatRelative('2026-10-28T11:59:40Z', now)).toBe('刚刚');
    expect(formatRelative('2026-10-28T11:30:00Z', now)).toBe('30 分钟前');
    expect(formatRelative('2026-10-28T09:00:00Z', now)).toBe('3 小时前');
    expect(formatRelative('2026-10-27T09:00:00Z', now)).toBe('昨天');
    expect(formatRelative('garbage', now)).toBe('—');
  });
});

describe('rowsFromSummary / keyRows', () => {
  it('rebuilds rows with device availability', () => {
    const rows = rowsFromSummary({ LUT: 100, FF: 20, Fmax: 50, errors: 0 }, { LC: 5280, LUT4: 5280, FF: 5280, IO: 39 });
    expect(rows).toEqual([
      { resource: 'LUT4', used: 100, available: 5280 },
      { resource: 'FF', used: 20, available: 5280 },
    ]);
    expect(rowsFromSummary({ BRAM: 3 }, {})).toEqual([{ resource: 'BRAM', used: 3, available: null }]);
    expect(rowsFromSummary(undefined, {})).toEqual([]);
  });
  it('picks key rows in order', () => {
    const k = keyRows([
      { resource: 'IO', used: 1, available: 2 },
      { resource: 'LUT6', used: 3, available: 4 },
      { resource: 'MMCM', used: 0, available: 5 },
    ]);
    expect(k.map((x) => x.key)).toEqual(['LUT', 'IO']);
  });
});
