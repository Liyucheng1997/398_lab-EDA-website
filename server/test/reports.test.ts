/** 利用率、时序、布局解析的单元测试 */
import { describe, expect, it } from 'vitest';
import { getDevice } from '@webeda/shared';
import { classifyCell, parseBel, parsePlacement, routingSegments } from '../src/flows/placement';
import { parseTimingReport, prettyClockName } from '../src/flows/timing';
import { buildUtilization, countDesignCells, mergePnrUtilization, resourceDevice, utilizationRows } from '../src/flows/utilization';
import type { YosysDesign } from '../src/flows/yosysJson';

const T = '00000000000000000000000000000001';

describe('countDesignCells', () => {
  const design: YosysDesign = {
    modules: {
      top: {
        attributes: { top: T },
        ports: { a: { direction: 'input', bits: [2, 3] }, y: { direction: 'output', bits: [4] } },
        cells: {
          u0: { type: 'sub', connections: {} },
          u1: { type: 'sub', connections: {} },
          g: { type: '$_AND_', connections: {} },
          s: { type: '$scopeinfo', connections: {} },
        },
      },
      sub: { cells: { l: { type: 'SB_LUT4', connections: {} }, f: { type: 'SB_DFF', connections: {} } } },
      SB_LUT4: { attributes: { blackbox: T }, ports: {} },
    },
  };

  it('expands submodules by instance count and skips $scopeinfo', () => {
    const c = countDesignCells(design);
    expect(c.top).toBe('top');
    expect(c.cells).toEqual({ $_AND_: 1, SB_DFF: 2, SB_LUT4: 2 });
    expect(c.modules).toEqual({ top: 1, sub: 2 });
    expect(c.topPortBits).toBe(3);
  });

  it('buildUtilization attaches device totals and module counts', () => {
    const u = buildUtilization('ice40', design, getDevice('ice40-hx1k-tq144'));
    expect(u.device).toBe('ice40-hx1k-tq144');
    expect(u.modules).toEqual({ top: 1, sub: 2 });
    expect(u.rows.find((r) => r.resource === 'LC')).toEqual({ resource: 'LC', used: 2, available: 1280 });
  });
});

describe('utilizationRows', () => {
  it('ice40', () => {
    const rows = utilizationRows(
      'ice40',
      { SB_LUT4: 10, SB_DFFE: 3, SB_DFFSR: 4, SB_CARRY: 12, SB_RAM40_4K: 2, SB_MAC16: 1, SB_IO: 5, SB_PLL40_CORE: 1, SB_GB: 2, SB_SPRAM256KA: 1 },
      99,
      getDevice('ice40-up5k-sg48')!.resources,
    );
    const m = Object.fromEntries(rows.map((r) => [r.resource, [r.used, r.available]]));
    expect(m).toEqual({
      LC: [12, 5280], LUT4: [10, 5280], FF: [7, 5280], CARRY: [12, 5280], BRAM: [2, 30], SPRAM: [1, 4], DSP: [1, 8], IO: [5, 39], PLL: [1, 1], GB: [2, 8],
    });
    expect(rows.map((r) => r.resource)).toEqual(['LC', 'LUT4', 'FF', 'CARRY', 'BRAM', 'SPRAM', 'DSP', 'IO', 'PLL', 'GB']);
  });

  it('ice40 without IO cells uses top port bits; unknown resources are null', () => {
    const rows = utilizationRows('ice40', { SB_LUT4: 1 }, 7);
    expect(rows.find((r) => r.resource === 'IO')).toEqual({ resource: 'IO', used: 7, available: null });
    expect(rows.some((r) => r.resource === 'DSP')).toBe(false);
  });

  it('ecp5', () => {
    const rows = utilizationRows('ecp5', { LUT4: 18, TRELLIS_FF: 53, CCU2C: 5, PFUMX: 2, DP16KD: 1, MULT18X18D: 1, TRELLIS_DPR16X4: 2 }, 33, getDevice('ecp5-25k-cabga256')!.resources);
    const m = Object.fromEntries(rows.map((r) => [r.resource, r.used]));
    expect(m).toMatchObject({ LUT4: 18, FF: 53, CARRY: 5, MUX: 2, LUTRAM: 2, BRAM: 1, DSP: 1, IO: 33 });
    expect(rows.find((r) => r.resource === 'BRAM')!.available).toBe(56);
  });

  it('xc7 counts LUT1..6, half BRAM18 and IO buffers', () => {
    const rows = utilizationRows(
      'xc7',
      { LUT1: 1, LUT2: 2, LUT6: 3, FDRE: 10, FDCE: 2, CARRY4: 3, RAMB18E1: 3, RAMB36E1: 1, DSP48E1: 1, IBUF: 17, OBUF: 24, BUFG: 1, MUXF7: 4, SRLC32E: 2, INV: 1 },
      0,
      getDevice('xc7a35t-cpg236')!.resources,
    );
    const m = Object.fromEntries(rows.map((r) => [r.resource, r.used]));
    expect(m).toMatchObject({ LUT6: 6, FF: 12, CARRY4: 3, BRAM: 2.5, DSP: 1, IO: 41, BUFG: 1, MUXF7: 4, SRL: 2 });
    expect(rows.find((r) => r.resource === 'LUT6')!.available).toBe(20800);
  });

  it('gowin', () => {
    const rows = utilizationRows('gowin', { LUT1: 2, LUT3: 16, LUT4: 14, DFF: 50, DFFR: 3, ALU: 10, MUX2_LUT5: 11, DPX9B: 1, MULT9X9: 1, IBUF: 17, OBUF: 24 }, 0);
    const m = Object.fromEntries(rows.map((r) => [r.resource, r.used]));
    expect(m).toMatchObject({ LUT4: 32, FF: 53, ALU: 10, MUX2: 11, BSRAM: 1, DSP: 1, IO: 41 });
  });

  it('generic reports FF, latches and gate types', () => {
    const rows = utilizationRows('generic', { $_AND_: 3, $_DFF_P_: 2, $_SDFFE_PP0P_: 1, $_DLATCH_P_: 1, $_XOR_: 5, $mem_v2: 1 }, 4);
    expect(rows).toEqual([
      { resource: 'FF', used: 3, available: null },
      { resource: 'LATCH', used: 1, available: null },
      { resource: 'XOR', used: 5, available: null },
      { resource: 'AND', used: 3, available: null },
      { resource: 'MEM_V2', used: 1, available: null },
      { resource: 'IO', used: 4, available: null },
    ]);
  });
});

describe('resourceDevice', () => {
  it('picks the requested device or the first of the family', () => {
    expect(resourceDevice('ice40', 'ice40-hx8k-ct256')).toMatchObject({ device: { id: 'ice40-hx8k-ct256' }, mismatch: false });
    expect(resourceDevice('ice40', 'xc7a35t-cpg236')).toMatchObject({ device: { id: 'ice40-hx1k-tq144' }, mismatch: true });
    expect(resourceDevice('gowin')).toMatchObject({ device: { id: 'gw1nr9-qn88p' }, mismatch: false });
    expect(resourceDevice('generic', 'ice40-hx1k-tq144')).toEqual({ device: undefined, mismatch: true });
    expect(resourceDevice('generic')).toEqual({ device: undefined, mismatch: false });
  });
});

describe('mergePnrUtilization', () => {
  it('overrides mapped rows and appends other used BELs', () => {
    const rows = [
      { resource: 'LC', used: 30, available: 5280 },
      { resource: 'IO', used: 6, available: 39 },
    ];
    const out = mergePnrUtilization(rows, 'ice40', {
      ICESTORM_LC: { used: 28, available: 5280 },
      SB_IO: { used: 3, available: 39 },
      SB_GB: { used: 1, available: 8 },
      ICESTORM_RAM: { used: 0, available: 30 },
      SB_WARMBOOT: { used: 1, available: 1 },
      SB_I2C: { used: 0, available: 2 },
    });
    expect(out).toEqual([
      { resource: 'LC', used: 28, available: 5280 },
      { resource: 'IO', used: 3, available: 39 },
      { resource: 'GB', used: 1, available: 8 },
      { resource: 'SB_WARMBOOT', used: 1, available: 1 },
    ]);
    expect(rows[0].used).toBe(30); // 不修改输入
    expect(mergePnrUtilization(rows, 'ecp5', undefined)).toBe(rows);
  });
});

describe('parseTimingReport', () => {
  const report = {
    fmax: {
      'clk$SB_IO_IN_$glb_clk': { achieved: 79.74481964111328, constraint: 12 },
      '$glbnet$fast$TRELLIS_IO_IN': { achieved: 90, constraint: 100 },
    },
    critical_paths: [
      {
        from: 'posedge clk',
        to: 'posedge clk',
        path: [
          { delay: 1.39, from: { cell: 'a_LC', port: 'O' }, to: { cell: 'a_LC', port: 'O' }, type: 'clk-to-q' },
          { delay: 1.761, from: { cell: 'a_LC', port: 'O' }, to: { cell: 'b_LC', port: 'I1' }, type: 'routing', net: 'cnt[0]', sources: ['blinky.v:2.14-2.17', '/share/ice40/x.v:1.1-2.2'] },
          { delay: 0.5, from: { cell: 'b_LC', port: 'I1' }, to: { cell: 'b_LC', port: 'O' }, type: 'logic', sources: ['/share/ice40/arith_map.v:62.5-70.4'] },
        ],
      },
      { from: 'x', to: 'y', path: [{ delay: 10, from: { cell: 'p' }, to: { cell: 'q', port: 'D' }, type: 'setup' }] },
      { from: 'empty', to: 'empty', path: [] },
    ],
  };

  it('computes clocks, slack and pass/fail', () => {
    const t = parseTimingReport(report, 12);
    expect(t.clocks).toEqual([
      { clock: 'fast', achievedMHz: 90, constraintMHz: 100, slackNs: -1.111, passed: false },
      { clock: 'clk', achievedMHz: 79.74, constraintMHz: 12, slackNs: 70.793, passed: true },
    ]);
  });

  it('builds critical paths sorted by delay, keeping user sources only', () => {
    const t = parseTimingReport(report, 12);
    expect(t.criticalPaths).toHaveLength(2);
    expect(t.criticalPaths[0]).toEqual({ from: 'p', to: 'q.D', totalDelayNs: 10, steps: [{ from: 'p', to: 'q.D', type: 'setup', delayNs: 10 }] });
    const p = t.criticalPaths[1];
    expect(p.from).toBe('a_LC.O');
    expect(p.to).toBe('b_LC.O');
    expect(p.totalDelayNs).toBe(3.651);
    expect(p.steps[1]).toEqual({ from: 'a_LC.O', to: 'b_LC.I1', type: 'routing', delayNs: 1.761, net: 'cnt[0]', source: 'blinky.v:2.14-2.17' });
    expect(p.steps[2].source).toBeUndefined();
  });

  it('handles missing reports and duplicate clock names', () => {
    expect(parseTimingReport(undefined, 12)).toEqual({ clocks: [], criticalPaths: [] });
    const t = parseTimingReport({ fmax: { 'clk$a': { achieved: 0 }, 'clk$b': { achieved: 50, constraint: 25 } } }, 12);
    expect(t.clocks.map((c) => c.clock).sort()).toEqual(['clk', 'clk (clk$b)']);
    expect(t.clocks.find((c) => c.achievedMHz === 0)).toMatchObject({ constraintMHz: 12, passed: false, slackNs: -83.333 });
  });

  it('prettyClockName', () => {
    expect(prettyClockName('clk$SB_IO_IN_$glb_clk')).toBe('clk');
    expect(prettyClockName('$glbnet$clk$TRELLIS_IO_IN')).toBe('clk');
    expect(prettyClockName('sys_clk')).toBe('sys_clk');
    expect(prettyClockName('$x')).toBe('$x');
  });
});

describe('placement', () => {
  it('parseBel', () => {
    expect(parseBel('X14/Y22/lc5')).toEqual({ x: 14, y: 22, z: 5 });
    expect(parseBel('X13/Y31/io1')).toEqual({ x: 13, y: 31, z: 1 });
    expect(parseBel('X12/Y31/gb')).toEqual({ x: 12, y: 31, z: 0 });
    expect(parseBel('X23/Y35/SLICEB.K1')).toEqual({ x: 23, y: 35, z: 3 });
    expect(parseBel('X22/Y35/SLICEA.FF0')).toEqual({ x: 22, y: 35, z: 0 });
    expect(parseBel('X72/Y35/PIOC')).toEqual({ x: 72, y: 35, z: 2 });
    expect(parseBel('garbage')).toBeUndefined();
  });

  it('classifyCell', () => {
    expect(classifyCell('ice40', 'ICESTORM_LC')).toBe('LC');
    expect(classifyCell('ice40', 'SB_IO')).toBe('IO');
    expect(classifyCell('ice40', 'ICESTORM_RAM')).toBe('RAM');
    expect(classifyCell('ice40', 'ICESTORM_DSP')).toBe('DSP');
    expect(classifyCell('ice40', 'ICESTORM_PLL')).toBe('PLL');
    expect(classifyCell('ice40', 'SB_GB')).toBe('GB');
    expect(classifyCell('ice40', 'SB_WARMBOOT')).toBe('OTHER');
    expect(classifyCell('ecp5', 'TRELLIS_COMB')).toBe('SLICE');
    expect(classifyCell('ecp5', 'TRELLIS_FF')).toBe('SLICE');
    expect(classifyCell('ecp5', 'TRELLIS_IO')).toBe('IO');
    expect(classifyCell('ecp5', 'DP16KD')).toBe('RAM');
    expect(classifyCell('ecp5', 'MULT18X18D')).toBe('DSP');
    expect(classifyCell('ecp5', 'EHXPLLL')).toBe('PLL');
    expect(classifyCell('ecp5', 'DCCA')).toBe('GB');
  });

  it('routingSegments (iCE40 explicit pip coordinates, ECP5 pip tile → wire tile)', () => {
    expect(
      routingSegments(
        'X14/Y22/lutff_4:in_3;X14/Y22/14.22.lutff_3:cout.->.14.22.lutff_4:in_3;1;X5/Y10/sp4_h_r_0;X6/Y10/6.10.sp4_h_l_0.->.5.10.sp4_h_r_0;1;X14/Y22/lutff_global:clk;X14/Y22/0.1.glb_netwk_4.->.14.22.lutff_global:clk;1;X0/Y1/glb_netwk_4;;1',
      ),
    ).toEqual([[6, 10, 5, 10]]);
    expect(routingSegments('X21/Y35/CLK0_SLICE;X21/Y35/0_0_MUXCLK0->0_0_CLK0_SLICE;5;X20/Y35/H02E0101;X21/Y35/H02W0100->H02E0101;1;X21/Y35/x;X20/Y35/y;1')).toEqual([
      [21, 35, 20, 35],
    ]);
    expect(routingSegments('')).toEqual([]);
  });

  it('parsePlacement with grid sizes and wire sampling', () => {
    const routing = Array.from({ length: 30 }, (_, i) => `X${i}/Y1/w;X${i + 1}/Y1/p;1`).join(';');
    const routed: YosysDesign = {
      modules: {
        top: {
          attributes: { top: T },
          cells: {
            a: { type: 'ICESTORM_LC', attributes: { NEXTPNR_BEL: 'X1/Y2/lc3' }, connections: {} },
            b: { type: 'SB_IO', attributes: { NEXTPNR_BEL: 'X40/Y0/io0' }, connections: {} },
            c: { type: 'SB_GB', connections: {} },
          },
          netnames: { n1: { bits: [2], attributes: { ROUTING: routing } }, n2: { bits: [2], attributes: { ROUTING: routing } } },
        },
      },
    };
    const p = parsePlacement(routed, 'ice40-up5k-sg48', 'ice40', 10);
    expect(p.cells).toEqual([
      { name: 'a', type: 'LC', x: 1, y: 2, z: 3 },
      { name: 'b', type: 'IO', x: 40, y: 0, z: 0 },
    ]);
    expect(p.width).toBe(41); // 超出已知网格时扩大
    expect(p.height).toBe(32);
    expect(p.wires).toHaveLength(10);
    expect(p.wires![0]).toEqual({ x1: 1, y1: 1, x2: 0, y2: 1, net: 'n1' });
  });
});
