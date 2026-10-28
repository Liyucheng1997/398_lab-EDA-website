/**
 * 资源利用率：从综合后网表统计单元 → 按器件族映射为 UtilizationRow；合并 nextpnr 布局后的真实用量。
 */
import type { DeviceInfo, SynthTarget, UtilizationReport, UtilizationRow } from '@webeda/shared';
import { DEVICES, getDevice } from '@webeda/shared';
import { designModules, findTopModule, isBlackbox, isRealCell, prettyModuleName, type YosysDesign } from './yosysJson';

export interface CellCount {
  /** 展开层次后的叶子单元计数 type -> count（不含 $scopeinfo 与用户子模块实例） */
  cells: Record<string, number>;
  /** 各（非黑盒）模块本地单元数（不含子模块实例），模块数 > 1 时才有意义 */
  modules: Record<string, number>;
  /** 顶层端口位数（I/O 估算用） */
  topPortBits: number;
  top: string;
}

/** 统计设计单元；子模块按实例数展开累加 */
export function countDesignCells(design: YosysDesign, topHint?: string): CellCount {
  const top = findTopModule(design, topHint) ?? '';
  const userMods = new Set(designModules(design));
  const memo = new Map<string, Map<string, number>>();
  const visiting = new Set<string>();

  const count = (name: string): Map<string, number> => {
    const cached = memo.get(name);
    if (cached) return cached;
    const res = new Map<string, number>();
    if (visiting.has(name)) return res;
    visiting.add(name);
    const mod = design.modules[name];
    for (const c of Object.values(mod?.cells ?? {})) {
      if (!isRealCell(c)) continue;
      if (userMods.has(c.type) && c.type !== name) {
        for (const [t, n] of count(c.type)) res.set(t, (res.get(t) ?? 0) + n);
      } else {
        res.set(c.type, (res.get(c.type) ?? 0) + 1);
      }
    }
    visiting.delete(name);
    memo.set(name, res);
    return res;
  };

  const cells: Record<string, number> = {};
  if (top) for (const [t, n] of [...count(top)].sort((a, b) => a[0].localeCompare(b[0]))) cells[t] = n;

  const modules: Record<string, number> = {};
  // 只统计从顶层可达的模块
  const reach = new Set<string>();
  const walk = (n: string) => {
    if (reach.has(n) || !userMods.has(n)) return;
    reach.add(n);
    for (const c of Object.values(design.modules[n]?.cells ?? {})) if (userMods.has(c.type)) walk(c.type);
  };
  if (top) walk(top);
  for (const n of reach) {
    let local = 0;
    for (const c of Object.values(design.modules[n].cells ?? {})) if (isRealCell(c) && !userMods.has(c.type)) local++;
    modules[prettyModuleName(n)] = local;
  }

  let topPortBits = 0;
  for (const p of Object.values(design.modules[top]?.ports ?? {})) topPortBits += p.bits.length;
  return { cells, modules, topPortBits, top };
}

/* ───────────────────────── 单元 → 资源 ───────────────────────── */

type Rule = [resource: string, test: (type: string) => boolean, weight?: (type: string) => number];

const sumBy = (cells: Record<string, number>, rule: Rule) => {
  let n = 0;
  for (const [t, c] of Object.entries(cells)) if (rule[1](t)) n += c * (rule[2]?.(t) ?? 1);
  return n;
};

const RULES: Record<Exclude<SynthTarget, 'generic'>, { rules: Rule[]; io: (t: string) => boolean; always: string[]; order: string[] }> = {
  ice40: {
    rules: [
      ['LUT4', (t) => t === 'SB_LUT4'],
      ['FF', (t) => t.startsWith('SB_DFF')],
      ['CARRY', (t) => t === 'SB_CARRY'],
      ['BRAM', (t) => t.startsWith('SB_RAM40_4K')],
      ['SPRAM', (t) => t === 'SB_SPRAM256KA'],
      ['DSP', (t) => t === 'SB_MAC16'],
      ['PLL', (t) => t.startsWith('SB_PLL40')],
      ['GB', (t) => t === 'SB_GB' || t === 'SB_GB_IO'],
    ],
    io: (t) => t.startsWith('SB_IO') || t === 'SB_GB_IO',
    always: ['LC', 'LUT4', 'FF', 'CARRY', 'BRAM', 'IO'],
    order: ['LC', 'LUT4', 'FF', 'CARRY', 'BRAM', 'SPRAM', 'DSP', 'IO', 'PLL', 'GB'],
  },
  ecp5: {
    rules: [
      ['LUT4', (t) => t === 'LUT4'],
      ['FF', (t) => t === 'TRELLIS_FF'],
      ['CARRY', (t) => t === 'CCU2C'],
      ['MUX', (t) => t === 'PFUMX' || t === 'L6MUX21'],
      ['LUTRAM', (t) => t === 'TRELLIS_DPR16X4' || t === 'DPR16X4'],
      ['BRAM', (t) => t === 'DP16KD' || t === 'PDPW16KD'],
      ['DSP', (t) => t === 'MULT18X18D'],
      ['ALU54', (t) => t === 'ALU54B'],
      ['PLL', (t) => t === 'EHXPLLL'],
    ],
    io: (t) => t === 'TRELLIS_IO' || t === 'IB' || t === 'OB' || t === 'BB' || t === 'OBZ',
    always: ['LUT4', 'FF', 'CARRY', 'BRAM', 'DSP', 'IO'],
    order: ['LUT4', 'FF', 'CARRY', 'MUX', 'LUTRAM', 'BRAM', 'DSP', 'ALU54', 'IO', 'PLL'],
  },
  xc7: {
    rules: [
      ['LUT6', (t) => /^LUT[1-6]$/.test(t)],
      ['FF', (t) => /^FD[A-Z]*(_1)?$/.test(t)],
      ['CARRY4', (t) => t === 'CARRY4'],
      ['MUXF7', (t) => t === 'MUXF7'],
      ['MUXF8', (t) => t === 'MUXF8'],
      ['SRL', (t) => /^SRL(C)?(16|32)E?$/.test(t)],
      ['LUTRAM', (t) => /^RAM(16|32|64|128|256)(X\d+[SD]|M)/.test(t)],
      ['BRAM', (t) => t === 'RAMB36E1' || t === 'RAMB18E1', (t) => (t === 'RAMB18E1' ? 0.5 : 1)],
      ['DSP', (t) => t === 'DSP48E1'],
      ['BUFG', (t) => /^BUF(G|GCTRL|HCE|R|IO)$/.test(t)],
      ['MMCM', (t) => /^(MMCME2|PLLE2)_/.test(t)],
    ],
    io: (t) => /^(IBUF|IBUFG|IBUFDS|OBUF|OBUFT|OBUFDS|IOBUF|IOBUFDS)(_.*)?$/.test(t),
    always: ['LUT6', 'FF', 'CARRY4', 'BRAM', 'DSP', 'IO'],
    order: ['LUT6', 'FF', 'CARRY4', 'MUXF7', 'MUXF8', 'SRL', 'LUTRAM', 'BRAM', 'DSP', 'IO', 'BUFG', 'MMCM'],
  },
  gowin: {
    rules: [
      ['LUT4', (t) => /^LUT[1-4]$/.test(t)],
      ['FF', (t) => /^DFF/.test(t)],
      ['ALU', (t) => t === 'ALU'],
      ['MUX2', (t) => /^MUX2_LUT[5-8]$/.test(t)],
      ['SSRAM', (t) => /^RAM16S/.test(t)],
      ['BSRAM', (t) => /^(SP|SPX9|SDP|SDPX9|SDPB|SDPX9B|DP|DPX9|DPB|DPX9B|ROM|ROMX9|pROM|pROMX9)$/.test(t)],
      ['DSP', (t) => /^(MULT9X9|MULT18X18|MULT36X36|MULTALU\w*|MULTADDALU\w*|ALU54D|PADD9|PADD18)$/.test(t)],
      ['PLL', (t) => /^(r?PLL|PLLVR)$/.test(t)],
    ],
    io: (t) => /^(IBUF|OBUF|IOBUF|TBUF|TLVDS_\w+|ELVDS_\w+)$/.test(t),
    always: ['LUT4', 'FF', 'ALU', 'BSRAM', 'IO'],
    order: ['LUT4', 'FF', 'ALU', 'MUX2', 'SSRAM', 'BSRAM', 'DSP', 'IO', 'PLL'],
  },
};

const GENERIC_FF = /^\$_(DFF|DFFE|SDFF|SDFFE|SDFFCE|DFFSR|DFFSRE|ALDFF|ALDFFE|FF)_/;
const GENERIC_LATCH = /^\$_(DLATCH|DLATCHSR|SR)_/;

/** 单元计数 → 资源行（available 来自 resources；未知资源为 null） */
export function utilizationRows(
  target: SynthTarget,
  cells: Record<string, number>,
  topPortBits: number,
  resources?: Record<string, number>,
): UtilizationRow[] {
  const avail = (r: string): number | null => (resources && r in resources ? resources[r] : null);
  if (target === 'generic') {
    const rows: UtilizationRow[] = [];
    let ff = 0;
    let latch = 0;
    const gates = new Map<string, number>();
    for (const [t, n] of Object.entries(cells)) {
      if (GENERIC_FF.test(t) || /^\$(a|s|)dffe?$|^\$dffsre?$|^\$ff$|^\$aldffe?$/.test(t)) ff += n;
      else if (GENERIC_LATCH.test(t) || /^\$(a)?dlatch$|^\$sr$/.test(t)) latch += n;
      else {
        const m = /^\$_(\w+?)_$/.exec(t);
        const name = m ? m[1] : t.replace(/^\$/, '').toUpperCase();
        gates.set(name, (gates.get(name) ?? 0) + n);
      }
    }
    rows.push({ resource: 'FF', used: ff, available: null });
    if (latch) rows.push({ resource: 'LATCH', used: latch, available: null });
    for (const [name, n] of [...gates].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      rows.push({ resource: name, used: n, available: null });
    }
    rows.push({ resource: 'IO', used: topPortBits, available: null });
    return rows;
  }
  const spec = RULES[target];
  const used = new Map<string, number>();
  for (const rule of spec.rules) used.set(rule[0], sumBy(cells, rule));
  let io = 0;
  for (const [t, n] of Object.entries(cells)) if (spec.io(t)) io += n;
  used.set('IO', io || topPortBits);
  if (target === 'ice40') used.set('LC', Math.max(used.get('LUT4') ?? 0, used.get('FF') ?? 0, used.get('CARRY') ?? 0));
  const rows: UtilizationRow[] = [];
  for (const r of spec.order) {
    const u = used.get(r) ?? 0;
    if (u > 0 || spec.always.includes(r) || (resources && r in resources)) rows.push({ resource: r, used: u, available: avail(r) });
  }
  return rows;
}

/** 选择提供资源总量的器件：指定器件且族一致 → 该器件；否则该族的第一个器件；generic → undefined */
export function resourceDevice(target: SynthTarget, deviceId?: string): { device?: DeviceInfo; mismatch: boolean } {
  if (target === 'generic') return { device: undefined, mismatch: !!deviceId && !!getDevice(deviceId) };
  const dev = deviceId ? getDevice(deviceId) : undefined;
  if (dev && dev.family === target) return { device: dev, mismatch: false };
  return { device: DEVICES.find((d) => d.family === target), mismatch: !!dev };
}

export function buildUtilization(target: SynthTarget, design: YosysDesign, device: DeviceInfo | undefined, topHint?: string): UtilizationReport {
  const cc = countDesignCells(design, topHint);
  const report: UtilizationReport = {
    target,
    rows: utilizationRows(target, cc.cells, cc.topPortBits, device?.resources),
    cells: cc.cells,
  };
  if (device) report.device = device.id;
  if (Object.keys(cc.modules).length > 1) report.modules = cc.modules;
  return report;
}

/* ───────────────────────── nextpnr 布局后利用率 ───────────────────────── */

const PNR_MAP: Record<'ice40' | 'ecp5', Record<string, string>> = {
  ice40: {
    ICESTORM_LC: 'LC',
    ICESTORM_RAM: 'BRAM',
    ICESTORM_DSP: 'DSP',
    ICESTORM_PLL: 'PLL',
    ICESTORM_SPRAM: 'SPRAM',
    SB_GB: 'GB',
    SB_IO: 'IO',
  },
  ecp5: {
    TRELLIS_COMB: 'LUT4',
    TRELLIS_FF: 'FF',
    TRELLIS_IO: 'IO',
    DP16KD: 'BRAM',
    MULT18X18D: 'DSP',
    ALU54B: 'ALU54',
    EHXPLLL: 'PLL',
    DCCA: 'GB',
  },
};

export type PnrUtilization = Record<string, { used: number; available: number }>;

/** 用 nextpnr report.json 的 utilization 覆盖综合估算（布局后的真实值），其他已使用的 BEL 追加为新行 */
export function mergePnrUtilization(rows: UtilizationRow[], family: 'ice40' | 'ecp5', pnr: PnrUtilization | undefined): UtilizationRow[] {
  if (!pnr) return rows;
  const out = rows.map((r) => ({ ...r }));
  const map = PNR_MAP[family];
  for (const [bel, v] of Object.entries(pnr)) {
    if (!v || typeof v.used !== 'number') continue;
    const res = map[bel];
    if (res) {
      const row = out.find((r) => r.resource === res);
      if (row) {
        row.used = v.used;
        row.available = typeof v.available === 'number' ? v.available : row.available;
      } else if (v.used > 0 || res === 'IO') {
        out.push({ resource: res, used: v.used, available: typeof v.available === 'number' ? v.available : null });
      }
    } else if (v.used > 0) {
      out.push({ resource: bel, used: v.used, available: typeof v.available === 'number' ? v.available : null });
    }
  }
  return out;
}
