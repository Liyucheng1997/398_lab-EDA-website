/** 门级网表转换、层次树、Yosys JSON 工具函数的单元测试 */
import { describe, expect, it } from 'vitest';
import type { CombGate, FlipFlop, Latch } from '@webeda/shared';
import { FlowError } from '../src/jobs/context';
import { convertGateNetlist, MAX_GATE_CELLS, topoSort } from '../src/flows/gateNetlist';
import { buildHierarchy, moduleDisplayNames, modulesBfs, singleModuleNetlist } from '../src/flows/hierarchy';
import { attrInt, attrTrue, findTopModule, prettyModuleName, safeFileStem, type YosysCell, type YosysDesign } from '../src/flows/yosysJson';
import { GateSim } from './gateEval';

const T = '00000000000000000000000000000001';
const cell = (type: string, connections: YosysCell['connections']): YosysCell => ({ type, connections });

describe('convertGateNetlist', () => {
  const design: YosysDesign = {
    modules: {
      top: {
        attributes: { top: T },
        ports: {
          clk: { direction: 'input', bits: [10] },
          d: { direction: 'input', bits: [11, 12] },
          q: { direction: 'output', bits: [20, 21] },
          k: { direction: 'output', bits: ['1', 'x'] },
        },
        cells: {
          // 故意打乱顺序：y2 依赖 y1
          g2: cell('$_XOR_', { A: [30], B: [11], Y: [31] }),
          g1: cell('$_ANDNOT_', { A: [11], B: [12], Y: [30] }),
          m: cell('$_NMUX_', { A: [11], B: [12], S: [10], Y: [32] }),
          a: cell('$_AOI3_', { A: [11], B: [12], C: [10], Y: [33] }),
          o: cell('$_OAI4_', { A: [11], B: [12], C: [10], D: [31], Y: [34] }),
          f0: cell('$_DFF_P_', { C: [10], D: [31], Q: [20] }),
          f1: cell('$_DFFE_PN1P_', { C: [10], R: [12], E: [11], D: [32], Q: [21] }),
          f2: cell('$_SDFFE_NP0N_', { C: [10], R: [12], E: [11], D: [33], Q: [40] }),
          l: cell('$_DLATCH_N_', { E: [10], D: [34], Q: [41] }),
          s: cell('$scopeinfo', {}),
        },
        netnames: {
          clk: { bits: [10] },
          d: { bits: [11, 12] },
          q: { bits: [20, 21], attributes: { init: '1x' } },
          'u0.state': { bits: [40], attributes: { init: '1' } },
          state: { bits: [40] },
          lat: { bits: [41], offset: 4 },
          bus: { bits: [30, 31, 32], offset: 2, upto: 1 },
          $hidden: { bits: [33] },
          hidden2: { bits: [34], hide_name: 1 },
        },
      },
    },
  };

  const n = convertGateNetlist(design);

  it('remaps nets densely with ports first and constants 0/1', () => {
    expect(n.top).toBe('top');
    expect(n.ports).toEqual([
      { name: 'clk', direction: 'input', bits: [2] },
      { name: 'd', direction: 'input', bits: [3, 4] },
      { name: 'q', direction: 'output', bits: [5, 6] },
      { name: 'k', direction: 'output', bits: [1, 0] },
    ]);
    const used = new Set<number>();
    for (const c of n.cells) for (const v of Object.values(c)) if (typeof v === 'number') used.add(v);
    expect(Math.max(...used)).toBeLessThan(n.netCount);
  });

  it('converts every cell type, decomposing complex gates', () => {
    const comb = n.cells.filter((c): c is CombGate => c.type !== 'DFF' && c.type !== 'LATCH');
    expect(comb.map((c) => c.type).sort()).toEqual(['AND', 'ANDNOT', 'MUX', 'NAND', 'NOT', 'NOR', 'OR', 'OR', 'XOR'].sort());
    expect(n.stats).toEqual({ gates: 9, flipflops: 3, latches: 1 });
    const ffs = n.cells.filter((c): c is FlipFlop => c.type === 'DFF');
    expect(ffs[0]).toEqual({ type: 'DFF', clk: 2, clkPol: 1, d: expect.any(Number), q: 5 });
    expect(ffs[1]).toMatchObject({ clkPol: 1, arst: 4, arstPol: 0, arstVal: 1, en: 3, enPol: 1, q: 6 });
    expect(ffs[2]).toMatchObject({ clkPol: 0, srst: 4, srstPol: 1, srstVal: 0, en: 3, enPol: 0, init: 1 });
    expect(ffs[0].init).toBeUndefined(); // init 'x'
    const l = n.cells.find((c): c is Latch => c.type === 'LATCH')!;
    expect(l).toMatchObject({ en: 2, enPol: 0 });
    // q 的 init "1x"：q[1]=1，q[0]=x
    expect(ffs[1].init).toBe(1);
  });

  it('orders combinational gates topologically, flip-flops last', () => {
    const idx = (y: number) => n.cells.findIndex((c) => 'y' in c && c.y === y);
    const xor = n.cells.find((c) => c.type === 'XOR') as CombGate;
    const andnot = n.cells.find((c) => c.type === 'ANDNOT') as CombGate;
    expect(idx(andnot.y)).toBeLessThan(idx(xor.y));
    const firstSeq = n.cells.findIndex((c) => c.type === 'DFF' || c.type === 'LATCH');
    expect(firstSeq).toBe(n.stats.gates);
    expect(n.combinationalLoop).toBe(false);
  });

  it('names user nets, preferring top-level names and honouring offset/upto', () => {
    const names = n.netNames!;
    const byName = Object.fromEntries(Object.entries(names).map(([k, v]) => [v, Number(k)]));
    expect(byName['clk']).toBe(2);
    expect(byName['d[0]']).toBe(3);
    expect(byName['q[1]']).toBe(6);
    expect(byName['state']).toBeDefined();
    expect(byName['u0.state']).toBeUndefined();
    expect(byName['lat[4]']).toBeDefined();
    expect(byName['bus[4]']).toBeDefined(); // upto：bits[0] 是最高索引
    expect(Object.values(names).some((v) => v.includes('hidden'))).toBe(false);
  });

  it('computes the decomposed gates correctly', () => {
    const sim = new GateSim(n);
    for (let clk = 0; clk < 2; clk++) {
      for (let d = 0; d < 4; d++) {
        sim.set('clk', clk);
        sim.set('d', d);
        const a = d & 1;
        const b = (d >> 1) & 1;
        const y1 = a & (b ^ 1);
        const y2 = y1 ^ a;
        const nmux = (clk ? b : a) ^ 1;
        const aoi3 = ((a & b) | clk) ^ 1;
        const oai4 = ((a | b) & (clk | y2)) ^ 1;
        const net = (name: string) => sim.v[Number(Object.entries(n.netNames!).find(([, nm]) => nm === name)![0])];
        expect(net('bus[4]')).toBe(y1);
        expect(net('bus[3]')).toBe(y2);
        expect(net('bus[2]')).toBe(nmux);
        const ffD = (n.cells.find((c) => c.type === 'DFF' && c.srst !== undefined) as FlipFlop).d;
        expect(sim.v[ffD]).toBe(aoi3);
        const latD = (n.cells.find((c) => c.type === 'LATCH') as Latch).d;
        expect(sim.v[latD]).toBe(oai4);
      }
    }
  });

  it('rejects unknown cell types with a list', () => {
    const bad: YosysDesign = { modules: { top: { attributes: { top: T }, cells: { a: cell('$_DFFSR_PPP_', {}), b: cell('$_TBUF_', {}), c: cell('$_TBUF_', {}) } } } };
    expect(() => convertGateNetlist(bad)).toThrow(FlowError);
    expect(() => convertGateNetlist(bad)).toThrow(/\$_DFFSR_PPP_ ×1.*\$_TBUF_ ×2/);
  });

  it('rejects oversized netlists', () => {
    const cells: Record<string, YosysCell> = {};
    for (let i = 0; i <= MAX_GATE_CELLS; i++) cells[`c${i}`] = cell('$_NOT_', { A: [2], Y: [3] });
    expect(() => convertGateNetlist({ modules: { top: { cells } } })).toThrow(/设计过大/);
  });

  it('handles an empty module', () => {
    const e = convertGateNetlist({ modules: { empty: { attributes: { top: T } } } });
    expect(e).toMatchObject({ top: 'empty', netCount: 2, ports: [], cells: [], combinationalLoop: false });
  });
});

describe('topoSort', () => {
  it('detects combinational loops and keeps the remaining gates', () => {
    const gates: CombGate[] = [
      { type: 'NOT', a: 3, y: 2 },
      { type: 'NOT', a: 2, y: 3 },
      { type: 'BUF', a: 5, y: 4 },
    ];
    const r = topoSort(gates);
    expect(r.loop).toBe(true);
    expect(r.order).toHaveLength(3);
    expect(r.order[0]).toBe(gates[2]);
  });

  it('sorts a chain', () => {
    const g: CombGate[] = [
      { type: 'NOT', a: 3, y: 4 },
      { type: 'NOT', a: 2, y: 3 },
    ];
    expect(topoSort(g)).toEqual({ order: [g[1], g[0]], loop: false });
  });
});

describe('yosysJson helpers', () => {
  it('prettyModuleName', () => {
    expect(prettyModuleName('counter')).toBe('counter');
    expect(prettyModuleName('\\counter')).toBe('counter');
    expect(prettyModuleName("$paramod\\adder\\W=s32'00000000000000000000000000001000")).toBe('adder(W=8)');
    expect(prettyModuleName("$paramod\\m\\A=s32'11111111111111111111111111111111\\B=4'x01z\\S=hello")).toBe("m(A=-1, B=4'bx01z, S=hello)");
    expect(prettyModuleName('$paramod$3f2a9bc1d\\fifo')).toBe('fifo$3f2a9b');
  });

  it('attribute helpers', () => {
    expect(attrTrue(T)).toBe(true);
    expect(attrTrue('00000000000000000000000000000000')).toBe(false);
    expect(attrTrue(1)).toBe(true);
    expect(attrTrue(undefined)).toBe(false);
    expect(attrInt('00000000000000000000000000000110')).toBe(6);
    expect(attrInt(undefined)).toBeUndefined();
  });

  it('safeFileStem', () => {
    expect(safeFileStem('adder(W=8)')).toBe('adder_W_8');
    expect(safeFileStem('$$$')).toBe('module');
    expect(safeFileStem('x'.repeat(200))).toHaveLength(80);
  });

  it('findTopModule falls back to an uninstantiated module', () => {
    const d: YosysDesign = { modules: { leaf: {}, root: { cells: { u: cell('leaf', {}) } } } };
    expect(findTopModule(d)).toBe('root');
    expect(findTopModule({ modules: {} })).toBeUndefined();
  });
});

describe('hierarchy helpers', () => {
  const p8 = "$paramod\\adder\\W=s32'00000000000000000000000000001000";
  const design: YosysDesign = {
    modules: {
      top: {
        attributes: { top: T },
        ports: { a: { direction: 'input', bits: [2] } },
        cells: {
          u_b: cell(p8, { a: [2] }),
          u_a: cell(p8, { a: [2] }),
          u_m: cell('mux', { a: [2] }),
          g: { type: '$and', connections: { A: [2], B: [2], Y: [3] }, port_directions: { A: 'input', B: 'input', Y: 'output' } },
          s: cell('$scopeinfo', {}),
          lib: cell('SB_LUT4', { I0: [2], O: [3] }),
        },
        netnames: { a: { bits: [2], attributes: { src: 'x' } } },
      },
      [p8]: { cells: { inner: cell('mux', {}) } },
      mux: {},
      SB_LUT4: { attributes: { blackbox: T } },
    },
  };

  it('buildHierarchy uses pretty module names and sorted instances', () => {
    const { root, truncated } = buildHierarchy(design, 'top');
    expect(truncated).toBe(false);
    expect(root).toEqual({
      module: 'top',
      instance: 'top',
      children: [
        { module: 'adder(W=8)', instance: 'u_a', children: [{ module: 'mux', instance: 'inner', children: [] }] },
        { module: 'adder(W=8)', instance: 'u_b', children: [{ module: 'mux', instance: 'inner', children: [] }] },
        { module: 'mux', instance: 'u_m', children: [] },
      ],
    });
    expect(moduleDisplayNames(design).get(p8)).toBe('adder(W=8)');
  });

  it('modulesBfs', () => {
    expect(modulesBfs(design, 'top')).toEqual(['top', p8, 'mux']);
  });

  it('singleModuleNetlist marks top, drops $scopeinfo and infers missing port directions', () => {
    const one = singleModuleNetlist(design, 'top');
    expect(Object.keys(one.modules)).toEqual(['top']);
    const m = one.modules.top;
    expect(m.attributes?.top).toBe(T);
    expect(Object.keys(m.cells!).sort()).toEqual(['g', 'lib', 'u_a', 'u_b', 'u_m']);
    expect(m.cells!.lib.port_directions).toEqual({ I0: 'input', O: 'output' });
    expect(m.netnames!.a.attributes).toEqual({});
  });
});
