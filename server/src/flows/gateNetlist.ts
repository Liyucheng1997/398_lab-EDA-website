/**
 * Yosys 门级 JSON（abc -g … + dfflegalize 之后）→ GateNetlist（shared/src/netlist.ts）
 */
import type { CombGate, FlipFlop, GateCell, GateNetlist, GatePort, GateType, Latch } from '@webeda/shared';
import { FlowError } from '../jobs/context';
import { findTopModule, type YosysBit, type YosysCell, type YosysDesign } from './yosysJson';

export const MAX_GATE_CELLS = 200_000;

const SIMPLE_2: Record<string, GateType> = {
  $_AND_: 'AND',
  $_OR_: 'OR',
  $_XOR_: 'XOR',
  $_NAND_: 'NAND',
  $_NOR_: 'NOR',
  $_XNOR_: 'XNOR',
  $_ANDNOT_: 'ANDNOT',
  $_ORNOT_: 'ORNOT',
};

const pol = (c: string): 0 | 1 => (c === 'P' ? 1 : 0);
const bitv = (c: string): 0 | 1 => (c === '1' ? 1 : 0);

export function convertGateNetlist(design: YosysDesign, topHint?: string): GateNetlist {
  const top = findTopModule(design, topHint);
  if (!top) throw new FlowError('门级网表中没有找到顶层模块');
  const mod = design.modules[top];
  const rawCells = Object.values(mod.cells ?? {}).filter((c) => c.type !== '$scopeinfo');
  if (rawCells.length > MAX_GATE_CELLS) {
    throw new FlowError(`设计过大：门级单元 ${rawCells.length} 个，超过虚拟开发板上限 ${MAX_GATE_CELLS}。请减小设计规模或使用参数覆盖缩小位宽/存储器深度。`);
  }

  // —— net 编号：0/1 为常量，Yosys 位号按首次出现顺序重排为 2,3,4…
  const remap = new Map<number, number>();
  let next = 2;
  const net = (b: YosysBit | undefined): number => {
    if (b === undefined) return 0;
    if (typeof b === 'number') {
      let id = remap.get(b);
      if (id === undefined) {
        id = next++;
        remap.set(b, id);
      }
      return id;
    }
    return b === '1' ? 1 : 0;
  };
  const fresh = () => next++;

  const ports: GatePort[] = [];
  for (const [name, p] of Object.entries(mod.ports ?? {})) {
    ports.push({ name, direction: p.direction, bits: p.bits.map(net) });
  }

  // —— 初值：Q 线网上的 init 属性（MSB 在前的字符串）
  const initOf = new Map<number, 0 | 1>();
  for (const n of Object.values(mod.netnames ?? {})) {
    const init = n.attributes?.init;
    if (init === undefined) continue;
    const s = typeof init === 'number' ? init.toString(2).padStart(n.bits.length, '0') : init;
    n.bits.forEach((b, i) => {
      const ch = s[s.length - 1 - i];
      if (typeof b === 'number' && (ch === '0' || ch === '1')) initOf.set(b, ch === '1' ? 1 : 0);
    });
  }

  const comb: CombGate[] = [];
  const ffs: FlipFlop[] = [];
  const latches: Latch[] = [];
  const unknown = new Map<string, number>();

  const conn = (c: YosysCell, port: string): YosysBit | undefined => c.connections?.[port]?.[0];
  const g2 = (type: GateType, a: number, b: number, y: number) => comb.push({ type, a, b, y });

  for (const c of rawCells) {
    const t = c.type;
    let m: RegExpExecArray | null;
    if (t === '$_BUF_' || t === '$_NOT_') {
      comb.push({ type: t === '$_BUF_' ? 'BUF' : 'NOT', a: net(conn(c, 'A')), y: net(conn(c, 'Y')) });
    } else if (SIMPLE_2[t]) {
      g2(SIMPLE_2[t], net(conn(c, 'A')), net(conn(c, 'B')), net(conn(c, 'Y')));
    } else if (t === '$_MUX_') {
      comb.push({ type: 'MUX', a: net(conn(c, 'A')), b: net(conn(c, 'B')), s: net(conn(c, 'S')), y: net(conn(c, 'Y')) });
    } else if (t === '$_NMUX_') {
      const tmp = fresh();
      comb.push({ type: 'MUX', a: net(conn(c, 'A')), b: net(conn(c, 'B')), s: net(conn(c, 'S')), y: tmp });
      comb.push({ type: 'NOT', a: tmp, y: net(conn(c, 'Y')) });
    } else if (t === '$_AOI3_' || t === '$_OAI3_') {
      // AOI3: Y = ~((A & B) | C)   OAI3: Y = ~((A | B) & C)
      const tmp = fresh();
      g2(t === '$_AOI3_' ? 'AND' : 'OR', net(conn(c, 'A')), net(conn(c, 'B')), tmp);
      g2(t === '$_AOI3_' ? 'NOR' : 'NAND', tmp, net(conn(c, 'C')), net(conn(c, 'Y')));
    } else if (t === '$_AOI4_' || t === '$_OAI4_') {
      // AOI4: Y = ~((A & B) | (C & D))   OAI4: Y = ~((A | B) & (C | D))
      const t1 = fresh();
      const t2 = fresh();
      const inner: GateType = t === '$_AOI4_' ? 'AND' : 'OR';
      g2(inner, net(conn(c, 'A')), net(conn(c, 'B')), t1);
      g2(inner, net(conn(c, 'C')), net(conn(c, 'D')), t2);
      g2(t === '$_AOI4_' ? 'NOR' : 'NAND', t1, t2, net(conn(c, 'Y')));
    } else if ((m = /^\$_DFF_([NP])_$/.exec(t))) {
      ffs.push(ff(c, m[1]));
    } else if ((m = /^\$_DFF_([NP])([NP])([01])_$/.exec(t))) {
      ffs.push({ ...ff(c, m[1]), arst: net(conn(c, 'R')), arstPol: pol(m[2]), arstVal: bitv(m[3]) });
    } else if ((m = /^\$_DFFE_([NP])([NP])_$/.exec(t))) {
      ffs.push({ ...ff(c, m[1]), en: net(conn(c, 'E')), enPol: pol(m[2]) });
    } else if ((m = /^\$_DFFE_([NP])([NP])([01])([NP])_$/.exec(t))) {
      ffs.push({ ...ff(c, m[1]), arst: net(conn(c, 'R')), arstPol: pol(m[2]), arstVal: bitv(m[3]), en: net(conn(c, 'E')), enPol: pol(m[4]) });
    } else if ((m = /^\$_SDFF_([NP])([NP])([01])_$/.exec(t))) {
      ffs.push({ ...ff(c, m[1]), srst: net(conn(c, 'R')), srstPol: pol(m[2]), srstVal: bitv(m[3]) });
    } else if ((m = /^\$_SDFFE_([NP])([NP])([01])([NP])_$/.exec(t))) {
      ffs.push({ ...ff(c, m[1]), srst: net(conn(c, 'R')), srstPol: pol(m[2]), srstVal: bitv(m[3]), en: net(conn(c, 'E')), enPol: pol(m[4]) });
    } else if ((m = /^\$_DLATCH_([NP])_$/.exec(t))) {
      const q = conn(c, 'Q');
      const l: Latch = { type: 'LATCH', en: net(conn(c, 'E')), enPol: pol(m[1]), d: net(conn(c, 'D')), q: net(q) };
      const init = typeof q === 'number' ? initOf.get(q) : undefined;
      if (init !== undefined) l.init = init;
      latches.push(l);
    } else {
      unknown.set(t, (unknown.get(t) ?? 0) + 1);
    }
  }

  function ff(c: YosysCell, clkPol: string): FlipFlop {
    const q = conn(c, 'Q');
    const f: FlipFlop = { type: 'DFF', clk: net(conn(c, 'C')), clkPol: pol(clkPol), d: net(conn(c, 'D')), q: net(q) };
    const init = typeof q === 'number' ? initOf.get(q) : undefined;
    if (init !== undefined) f.init = init;
    return f;
  }

  if (unknown.size) {
    const list = [...unknown].map(([t, n]) => `${t} ×${n}`).join('、');
    throw new FlowError(`门级网表包含虚拟开发板不支持的单元：${list}。通常由同时带异步置位和复位的触发器、异步加载触发器或三态总线引起，请修改设计。`);
  }

  // —— 用户命名的线网：顶层（不含 '.'）优先
  const netNames: Record<number, string> = {};
  const named = Object.entries(mod.netnames ?? {})
    .filter(([name, n]) => !name.startsWith('$') && !n.hide_name)
    .sort((a, b) => Number(a[0].includes('.')) - Number(b[0].includes('.')) || a[0].length - b[0].length);
  for (const [name, n] of named) {
    const width = n.bits.length;
    const offset = n.offset ?? 0;
    n.bits.forEach((b, i) => {
      if (typeof b !== 'number') return;
      const id = remap.get(b);
      if (id === undefined || netNames[id] !== undefined) return;
      const idx = n.upto ? offset + (width - 1 - i) : offset + i;
      netNames[id] = width > 1 || offset !== 0 ? `${name}[${idx}]` : name;
    });
  }

  const { order, loop } = topoSort(comb);
  const cells: GateCell[] = [...order, ...ffs, ...latches];
  return {
    top,
    netCount: next,
    ports,
    cells,
    combinationalLoop: loop,
    netNames,
    stats: { gates: comb.length, flipflops: ffs.length, latches: latches.length },
  };
}

/**
 * 组合门拓扑排序（Kahn）。触发器/锁存器输出、端口与常量视为源。
 * 有组合环时：已排好的前缀 + 环上剩余的门（保持原序），loop = true。
 */
export function topoSort(gates: CombGate[]): { order: CombGate[]; loop: boolean } {
  const driver = new Map<number, number>();
  gates.forEach((g, i) => driver.set(g.y, i));
  const indeg = new Int32Array(gates.length);
  const users = new Map<number, number[]>();
  gates.forEach((g, i) => {
    const ins = [g.a, g.b, g.s].filter((x): x is number => x !== undefined);
    for (const n of new Set(ins)) {
      const d = driver.get(n);
      if (d === undefined) continue;
      indeg[i]++;
      let list = users.get(d);
      if (!list) users.set(d, (list = []));
      list.push(i);
    }
  });
  const queue: number[] = [];
  for (let i = 0; i < gates.length; i++) if (indeg[i] === 0) queue.push(i);
  const order: CombGate[] = [];
  const placed = new Uint8Array(gates.length);
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    order.push(gates[i]);
    placed[i] = 1;
    for (const u of users.get(i) ?? []) if (--indeg[u] === 0) queue.push(u);
  }
  if (order.length === gates.length) return { order, loop: false };
  for (let i = 0; i < gates.length; i++) if (!placed[i]) order.push(gates[i]);
  return { order, loop: true };
}
