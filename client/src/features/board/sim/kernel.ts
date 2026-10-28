/**
 * 门级仿真内核（纯 TS，无 DOM 依赖，可在 Worker 与 vitest 中运行）。
 *
 * - 所有 net 的值保存在一个 Uint8Array 中，取值恒为 0/1；0 号恒 0，1 号恒 1。
 * - 组合门编译成直线代码（new Function，分块以便 V8 优化）；不支持 new Function（CSP）时退回解释器。
 * - 有组合环（combinationalLoop）时迭代求值直到稳定（最多 64 遍），不稳定则标记振荡。
 * - 时序：每次求值后检测所有触发器时钟 net 的边沿（包括逻辑派生的时钟），
 *   两阶段采样（先算出所有被触发 FF 的次态，再统一写回），同步复位优先于使能，
 *   异步复位/置位在每次求值后都会重新施加；锁存器在使能有效时透明。
 */
import type { CombGate, FlipFlop, GateNetlist, GateType, Latch } from '@webeda/shared';

/** 组合门 + 锁存器/异步复位不动点的最大迭代次数 */
export const MAX_COMB_PASSES = 64;
/** 一次 settle 中「边沿 → 写回 → 求值」的最大轮数（派生时钟级联深度） */
export const MAX_DELTA_CYCLES = 256;
/** 每个编译函数最多包含的语句数（过大的函数 V8 不会优化） */
const CHUNK_STATEMENTS = 500;

const GATE_CODES: Record<GateType, number> = {
  BUF: 0,
  NOT: 1,
  AND: 2,
  OR: 3,
  XOR: 4,
  NAND: 5,
  NOR: 6,
  XNOR: 7,
  ANDNOT: 8,
  ORNOT: 9,
  MUX: 10,
};

export class NetlistError extends Error {}

export interface KernelOptions {
  /** 强制使用解释器（测试 / CSP 环境） */
  interpret?: boolean;
}

type CombFn = (v: Uint8Array) => number;
type SeqFn = (v: Uint8Array, nx: Uint8Array) => void;

function isFF(c: GateNetlist['cells'][number]): c is FlipFlop {
  return c.type === 'DFF';
}
function isLatch(c: GateNetlist['cells'][number]): c is Latch {
  return c.type === 'LATCH';
}

function gateExpr(g: CombGate): string {
  const a = `v[${g.a}]`;
  const b = `v[${g.b ?? 0}]`;
  switch (g.type) {
    case 'BUF':
      return a;
    case 'NOT':
      return `${a}^1`;
    case 'AND':
      return `${a}&${b}`;
    case 'OR':
      return `${a}|${b}`;
    case 'XOR':
      return `${a}^${b}`;
    case 'NAND':
      return `(${a}&${b})^1`;
    case 'NOR':
      return `(${a}|${b})^1`;
    case 'XNOR':
      return `${a}^${b}^1`;
    case 'ANDNOT':
      return `${a}&(${b}^1)`;
    case 'ORNOT':
      return `${a}|(${b}^1)`;
    case 'MUX':
      return `(v[${g.s ?? 0}]?${b}:${a})`;
  }
}

/** 校验网表结构，返回错误信息（null = 合法） */
export function validateNetlist(nl: GateNetlist): string | null {
  if (!nl || typeof nl !== 'object') return '网表为空';
  const n = nl.netCount;
  if (!Number.isInteger(n) || n < 2) return `netCount 无效：${String(n)}`;
  if (n > 50_000_000) return `网表过大（${n} 个 net）`;
  if (!Array.isArray(nl.cells) || !Array.isArray(nl.ports)) return '网表缺少 cells 或 ports';
  const ok = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < n;
  for (let i = 0; i < nl.cells.length; i++) {
    const c = nl.cells[i];
    const bad = (field: string) => `第 ${i} 个单元（${c.type}）的 ${field} 引用了无效的 net`;
    if (isFF(c)) {
      for (const f of ['clk', 'd', 'q'] as const) if (!ok(c[f])) return bad(f);
      for (const f of ['en', 'arst', 'srst'] as const) if (c[f] !== undefined && !ok(c[f])) return bad(f);
    } else if (isLatch(c)) {
      for (const f of ['en', 'd', 'q'] as const) if (!ok(c[f])) return bad(f);
    } else {
      if (!(c.type in GATE_CODES)) return `第 ${i} 个单元类型未知：${String((c as { type: unknown }).type)}`;
      if (!ok(c.a) || !ok(c.y)) return bad('a/y');
      if (c.b !== undefined && !ok(c.b)) return bad('b');
      if (c.s !== undefined && !ok(c.s)) return bad('s');
      if (c.type === 'MUX' && (c.b === undefined || c.s === undefined)) return `第 ${i} 个 MUX 缺少 b/s`;
      if (c.type !== 'BUF' && c.type !== 'NOT' && c.b === undefined) return `第 ${i} 个 ${c.type} 缺少输入 b`;
    }
  }
  for (const p of nl.ports) {
    if (!p || typeof p.name !== 'string' || !Array.isArray(p.bits)) return '端口格式无效';
    for (const b of p.bits) if (!ok(b)) return `端口 ${p.name} 引用了无效的 net`;
  }
  return null;
}

/** 把时序采样/写回语句切成多个函数 */
function compileSeqChunks(stmts: string[]): SeqFn[] {
  const fns: SeqFn[] = [];
  for (let i = 0; i < stmts.length; i += CHUNK_STATEMENTS) {
    const body = stmts.slice(i, i + CHUNK_STATEMENTS).join('\n');
    fns.push(new Function('v', 'nx', `"use strict";\n${body}`) as SeqFn);
  }
  return fns;
}

/** 把语句切成多个函数；每个函数返回「是否有值变化」 */
function compileChunks(stmts: string[], withChange: boolean): CombFn[] {
  const fns: CombFn[] = [];
  for (let i = 0; i < stmts.length; i += CHUNK_STATEMENTS) {
    const body = stmts.slice(i, i + CHUNK_STATEMENTS).join('\n');
    const src = withChange ? `"use strict";let c=0,t=0;\n${body}\nreturn c;` : `"use strict";\n${body}\nreturn 0;`;
    fns.push(new Function('v', src) as CombFn);
  }
  return fns;
}

export class Simulator {
  readonly netlist: GateNetlist;
  readonly netCount: number;
  /** 所有 net 的当前值 */
  readonly v: Uint8Array;
  readonly compiled: boolean;
  readonly combGateCount: number;
  readonly loopMode: boolean;

  /** 累计组合门求值次数（性能统计） */
  gateEvals = 0;
  /** 是否检测到组合振荡或派生时钟无法收敛（直到 reset 前保持） */
  oscillating = false;

  // 组合门
  private combFns: CombFn[] = [];
  private ops: Int32Array; // 解释器用：每门 5 个 int（code,a,b,s,y）

  // 触发器（按时钟 net 分组）
  private readonly ffCount: number;
  private readonly ffD: Int32Array;
  private readonly ffQ: Int32Array;
  private readonly ffEn: Int32Array;
  private readonly ffEnPol: Uint8Array;
  private readonly ffSrst: Int32Array;
  private readonly ffSrstPol: Uint8Array;
  private readonly ffSrstVal: Uint8Array;
  private readonly ffArst: Int32Array;
  private readonly ffArstPol: Uint8Array;
  private readonly ffArstVal: Uint8Array;
  private readonly ffInit: Uint8Array;
  private readonly nx: Uint8Array;
  /** 有异步复位的 FF 下标 */
  private readonly arstList: Int32Array;

  private readonly grpClk: Int32Array;
  /** 每组：上升沿 FF 下标范围 [posStart, posEnd)，下降沿 [negStart, negEnd)（FF 已按组排序） */
  private readonly grpPosStart: Int32Array;
  private readonly grpPosEnd: Int32Array;
  private readonly grpNegStart: Int32Array;
  private readonly grpNegEnd: Int32Array;
  /** 编译后的采样/写回函数：下标 g*2（上升沿）/ g*2+1（下降沿）；未编译时为空 */
  private seqSample: SeqFn[][] = [];
  private seqCommit: SeqFn[][] = [];
  private readonly grpPrev: Uint8Array;
  private readonly grpTrig: Uint8Array;

  // 锁存器
  private readonly latEn: Int32Array;
  private readonly latEnPol: Uint8Array;
  private readonly latD: Int32Array;
  private readonly latQ: Int32Array;
  private readonly latInit: Uint8Array;

  /** 被组合逻辑 / 锁存器 / 异步复位读取的 net（改变它们需要重新求值组合逻辑） */
  private readonly readByLogic: Uint8Array;

  constructor(netlist: GateNetlist, opts: KernelOptions = {}) {
    const err = validateNetlist(netlist);
    if (err) throw new NetlistError(err);
    this.netlist = netlist;
    this.netCount = netlist.netCount;
    this.v = new Uint8Array(this.netCount);
    this.loopMode = !!netlist.combinationalLoop;
    this.readByLogic = new Uint8Array(this.netCount);

    const comb: CombGate[] = [];
    const ffs: FlipFlop[] = [];
    const lats: Latch[] = [];
    for (const c of netlist.cells) {
      if (isFF(c)) ffs.push(c);
      else if (isLatch(c)) lats.push(c);
      else if (c.y >= 2) comb.push(c); // 不允许写常量 net
    }
    this.combGateCount = comb.length;
    const rbl = this.readByLogic;
    for (const g of comb) {
      rbl[g.a] = 1;
      if (g.b !== undefined) rbl[g.b] = 1;
      if (g.s !== undefined) rbl[g.s] = 1;
    }
    for (const l of lats) {
      rbl[l.en] = 1;
      rbl[l.d] = 1;
    }
    for (const f of ffs) if (f.arst !== undefined) rbl[f.arst] = 1;

    // 解释器操作码（总是生成，供回退和测试）
    this.ops = new Int32Array(comb.length * 5);
    comb.forEach((g, i) => {
      const o = i * 5;
      this.ops[o] = GATE_CODES[g.type];
      this.ops[o + 1] = g.a;
      this.ops[o + 2] = g.b ?? 0;
      this.ops[o + 3] = g.s ?? 0;
      this.ops[o + 4] = g.y;
    });

    let compiled = false;
    if (!opts.interpret && comb.length > 0) {
      try {
        const stmts = comb.map((g) =>
          this.loopMode ? `t=${gateExpr(g)};if(v[${g.y}]!==t){v[${g.y}]=t;c=1}` : `v[${g.y}]=${gateExpr(g)};`,
        );
        this.combFns = compileChunks(stmts, this.loopMode);
        compiled = true;
      } catch {
        this.combFns = [];
        compiled = false;
      }
    }
    this.compiled = compiled;

    // 触发器：按时钟 net 分组排序（同组上升沿在前、下降沿在后），下标即组内位置
    const groups = new Map<number, { pos: FlipFlop[]; neg: FlipFlop[] }>();
    for (const f of ffs) {
      let g = groups.get(f.clk);
      if (!g) groups.set(f.clk, (g = { pos: [], neg: [] }));
      (f.clkPol === 0 ? g.neg : g.pos).push(f);
    }
    ffs.length = 0;
    const ng = groups.size;
    this.grpClk = new Int32Array(ng);
    this.grpPosStart = new Int32Array(ng);
    this.grpPosEnd = new Int32Array(ng);
    this.grpNegStart = new Int32Array(ng);
    this.grpNegEnd = new Int32Array(ng);
    this.grpPrev = new Uint8Array(ng);
    this.grpTrig = new Uint8Array(ng);
    {
      let gi = 0;
      for (const [clk, g] of groups) {
        this.grpClk[gi] = clk;
        this.grpPosStart[gi] = ffs.length;
        for (const f of g.pos) ffs.push(f);
        this.grpPosEnd[gi] = ffs.length;
        this.grpNegStart[gi] = ffs.length;
        for (const f of g.neg) ffs.push(f);
        this.grpNegEnd[gi] = ffs.length;
        gi++;
      }
    }
    const nf = ffs.length;
    this.ffCount = nf;
    this.ffD = new Int32Array(nf);
    this.ffQ = new Int32Array(nf);
    this.ffEn = new Int32Array(nf);
    this.ffEnPol = new Uint8Array(nf);
    this.ffSrst = new Int32Array(nf);
    this.ffSrstPol = new Uint8Array(nf);
    this.ffSrstVal = new Uint8Array(nf);
    this.ffArst = new Int32Array(nf);
    this.ffArstPol = new Uint8Array(nf);
    this.ffArstVal = new Uint8Array(nf);
    this.ffInit = new Uint8Array(nf);
    this.nx = new Uint8Array(nf);
    const arst: number[] = [];
    ffs.forEach((f, i) => {
      this.ffD[i] = f.d;
      this.ffQ[i] = f.q;
      // 无使能 → 恒为 1 的 net 且有效电平 1；无同步复位 → 恒 0 的 net 且有效电平 1（永不有效）
      if (f.en !== undefined) {
        this.ffEn[i] = f.en;
        this.ffEnPol[i] = f.enPol === 0 ? 0 : 1;
      } else {
        this.ffEn[i] = 1;
        this.ffEnPol[i] = 1;
      }
      if (f.srst !== undefined) {
        this.ffSrst[i] = f.srst;
        this.ffSrstPol[i] = f.srstPol === 0 ? 0 : 1;
        this.ffSrstVal[i] = f.srstVal === 1 ? 1 : 0;
      } else {
        this.ffSrst[i] = 0;
        this.ffSrstPol[i] = 1;
      }
      if (f.arst !== undefined) {
        this.ffArst[i] = f.arst;
        this.ffArstPol[i] = f.arstPol === 0 ? 0 : 1;
        this.ffArstVal[i] = f.arstVal === 1 ? 1 : 0;
        arst.push(i);
      } else {
        this.ffArst[i] = 0;
        this.ffArstPol[i] = 1;
      }
      this.ffInit[i] = f.init === 1 ? 1 : 0;
    });
    this.arstList = Int32Array.from(arst);

    if (!opts.interpret) {
      try {
        const sample: SeqFn[][] = [];
        const commit: SeqFn[][] = [];
        for (let g = 0; g < ng; g++) {
          for (const [s, e] of [
            [this.grpPosStart[g], this.grpPosEnd[g]],
            [this.grpNegStart[g], this.grpNegEnd[g]],
          ]) {
            const ss: string[] = [];
            const cs: string[] = [];
            for (let i = s; i < e; i++) ss.push(`nx[${i}]=${this.nextExpr(i)};`);
            for (let i = s; i < e; i++) cs.push(`v[${this.ffQ[i]}]=nx[${i}];`);
            sample.push(compileSeqChunks(ss));
            commit.push(compileSeqChunks(cs));
          }
        }
        this.seqSample = sample;
        this.seqCommit = commit;
      } catch {
        this.seqSample = [];
        this.seqCommit = [];
      }
    }

    // 锁存器
    const nl2 = lats.length;
    this.latEn = new Int32Array(nl2);
    this.latEnPol = new Uint8Array(nl2);
    this.latD = new Int32Array(nl2);
    this.latQ = new Int32Array(nl2);
    this.latInit = new Uint8Array(nl2);
    lats.forEach((l, i) => {
      this.latEn[i] = l.en;
      this.latEnPol[i] = l.enPol === 0 ? 0 : 1;
      this.latD[i] = l.d;
      this.latQ[i] = l.q;
      this.latInit[i] = l.init === 1 ? 1 : 0;
    });

    this.reset();
  }

  /** 第 i 个触发器的次态表达式（优先级：异步复位 > 同步复位 > 使能） */
  private nextExpr(i: number): string {
    let e = `v[${this.ffD[i]}]`;
    if (!(this.ffEn[i] === 1 && this.ffEnPol[i] === 1)) e = `(v[${this.ffEn[i]}]===${this.ffEnPol[i]}?${e}:v[${this.ffQ[i]}])`;
    if (!(this.ffSrst[i] === 0 && this.ffSrstPol[i] === 1)) e = `(v[${this.ffSrst[i]}]===${this.ffSrstPol[i]}?${this.ffSrstVal[i]}:${e})`;
    if (!(this.ffArst[i] === 0 && this.ffArstPol[i] === 1)) e = `(v[${this.ffArst[i]}]===${this.ffArstPol[i]}?${this.ffArstVal[i]}:${e})`;
    return e;
  }

  get flipflopCount(): number {
    return this.ffCount;
  }
  get latchCount(): number {
    return this.latQ.length;
  }
  get clockNetCount(): number {
    return this.grpClk.length;
  }

  /**
   * 恢复上电状态：所有 net 清零，FF/锁存器取初值，然后求值组合逻辑。
   * 已设置的输入值需由调用方在 reset 后重新写入（见 SimRunner）。
   * 返回前记录各时钟 net 的当前值，上电时不产生边沿。
   */
  reset(inputs?: ReadonlyArray<readonly [number, number]>): void {
    const v = this.v;
    v.fill(0);
    v[1] = 1;
    for (let i = 0; i < this.ffCount; i++) v[this.ffQ[i]] = this.ffInit[i];
    for (let i = 0; i < this.latQ.length; i++) v[this.latQ[i]] = this.latInit[i];
    if (inputs) for (const [net, val] of inputs) if (net >= 2) v[net] = val ? 1 : 0;
    v[0] = 0;
    v[1] = 1;
    this.oscillating = false;
    this.evalComb();
    for (let g = 0; g < this.grpClk.length; g++) this.grpPrev[g] = this.v[this.grpClk[g]];
    this.grpTrig.fill(0);
  }

  /** 设置一个 net 的值（不求值）；返回值是否改变 */
  setNet(net: number, val: number): boolean {
    if (net < 2 || net >= this.netCount) return false;
    const b = val ? 1 : 0;
    if (this.v[net] === b) return false;
    this.v[net] = b;
    return true;
  }

  get(net: number): number {
    return this.v[net];
  }

  /** 该 net 是否被组合逻辑（含锁存器、异步复位）读取 */
  feedsLogic(net: number): boolean {
    return this.readByLogic[net] === 1;
  }

  /** 组合逻辑单遍求值；返回是否有变化（非环模式恒返回 0） */
  private combPass(): number {
    const v = this.v;
    this.gateEvals += this.combGateCount;
    if (this.compiled) {
      let c = 0;
      const fns = this.combFns;
      for (let i = 0; i < fns.length; i++) c |= fns[i](v);
      return c;
    }
    return this.interpretPass(this.loopMode);
  }

  private interpretPass(track: boolean): number {
    const v = this.v;
    const ops = this.ops;
    let changed = 0;
    for (let o = 0; o < ops.length; o += 5) {
      const a = v[ops[o + 1]];
      const b = v[ops[o + 2]];
      let r: number;
      switch (ops[o]) {
        case 0:
          r = a;
          break;
        case 1:
          r = a ^ 1;
          break;
        case 2:
          r = a & b;
          break;
        case 3:
          r = a | b;
          break;
        case 4:
          r = a ^ b;
          break;
        case 5:
          r = (a & b) ^ 1;
          break;
        case 6:
          r = (a | b) ^ 1;
          break;
        case 7:
          r = a ^ b ^ 1;
          break;
        case 8:
          r = a & (b ^ 1);
          break;
        case 9:
          r = a | (b ^ 1);
          break;
        default:
          r = v[ops[o + 3]] ? b : a;
      }
      const y = ops[o + 4];
      if (track && v[y] !== r) changed = 1;
      v[y] = r;
    }
    return changed;
  }

  /** 锁存器透明 + 异步复位施加；返回是否有变化 */
  private fixPass(): number {
    const v = this.v;
    let c = 0;
    const le = this.latEn;
    for (let i = 0; i < le.length; i++) {
      if (v[le[i]] === this.latEnPol[i]) {
        const q = this.latQ[i];
        const d = v[this.latD[i]];
        if (v[q] !== d) {
          v[q] = d;
          c = 1;
        }
      }
    }
    const al = this.arstList;
    for (let k = 0; k < al.length; k++) {
      const i = al[k];
      if (v[this.ffArst[i]] === this.ffArstPol[i]) {
        const q = this.ffQ[i];
        const val = this.ffArstVal[i];
        if (v[q] !== val) {
          v[q] = val;
          c = 1;
        }
      }
    }
    return c;
  }

  /** 组合逻辑 + 锁存器/异步复位的不动点求值 */
  evalComb(): void {
    for (let outer = 0; outer < MAX_COMB_PASSES; outer++) {
      if (this.loopMode) {
        let stable = false;
        for (let p = 0; p < MAX_COMB_PASSES; p++) {
          if (!this.combPass()) {
            stable = true;
            break;
          }
        }
        if (!stable) this.oscillating = true;
      } else {
        this.combPass();
      }
      if (!this.fixPass()) return;
    }
    this.oscillating = true;
  }

  /**
   * 求值并处理所有时钟边沿，直到没有新的边沿。
   * @param needComb 为 false 时跳过第一遍组合求值（调用方保证改动的 net 不被组合逻辑读取）
   * @returns 是否有触发器被触发
   */
  settle(needComb = true): boolean {
    const v = this.v;
    const ng = this.grpClk.length;
    let any = false;
    for (let iter = 0; iter < MAX_DELTA_CYCLES; iter++) {
      if (needComb) this.evalComb();
      needComb = true;
      if (ng === 0) return any;
      // 1. 检测边沿
      let trig = false;
      for (let g = 0; g < ng; g++) {
        const c = v[this.grpClk[g]];
        if (c !== this.grpPrev[g]) {
          this.grpPrev[g] = c;
          if (c === 1 ? this.grpPosEnd[g] > this.grpPosStart[g] : this.grpNegEnd[g] > this.grpNegStart[g]) {
            this.grpTrig[g] = c === 1 ? 1 : 2;
            trig = true;
          }
        }
      }
      if (!trig) return any;
      any = true;
      // 2. 采样：先计算全部被触发 FF 的次态；3. 再统一写回（两阶段）
      const nx = this.nx;
      const trigs = this.grpTrig;
      if (this.seqSample.length > 0) {
        for (let g = 0; g < ng; g++) {
          const t = trigs[g];
          if (!t) continue;
          const fns = this.seqSample[g * 2 + t - 1];
          for (let i = 0; i < fns.length; i++) fns[i](v, nx);
        }
        for (let g = 0; g < ng; g++) {
          const t = trigs[g];
          if (!t) continue;
          trigs[g] = 0;
          const fns = this.seqCommit[g * 2 + t - 1];
          for (let i = 0; i < fns.length; i++) fns[i](v, nx);
        }
      } else {
        const ffQ = this.ffQ;
        const ffD = this.ffD;
        const ffEn = this.ffEn;
        const ffEnPol = this.ffEnPol;
        const ffSrst = this.ffSrst;
        const ffSrstPol = this.ffSrstPol;
        const ffSrstVal = this.ffSrstVal;
        const ffArst = this.ffArst;
        const ffArstPol = this.ffArstPol;
        const ffArstVal = this.ffArstVal;
        for (let g = 0; g < ng; g++) {
          const t = trigs[g];
          if (!t) continue;
          const s = t === 1 ? this.grpPosStart[g] : this.grpNegStart[g];
          const e = t === 1 ? this.grpPosEnd[g] : this.grpNegEnd[g];
          for (let i = s; i < e; i++) {
            if (v[ffArst[i]] === ffArstPol[i]) nx[i] = ffArstVal[i];
            else if (v[ffSrst[i]] === ffSrstPol[i]) nx[i] = ffSrstVal[i];
            else if (v[ffEn[i]] === ffEnPol[i]) nx[i] = v[ffD[i]];
            else nx[i] = v[ffQ[i]];
          }
        }
        for (let g = 0; g < ng; g++) {
          const t = trigs[g];
          if (!t) continue;
          trigs[g] = 0;
          const s = t === 1 ? this.grpPosStart[g] : this.grpNegStart[g];
          const e = t === 1 ? this.grpPosEnd[g] : this.grpNegEnd[g];
          for (let i = s; i < e; i++) v[ffQ[i]] = nx[i];
        }
      }
    }
    this.oscillating = true;
    return any;
  }

  /** 设置一组 net 为同一值并 settle（时钟驱动用）；只在必要时求值组合逻辑 */
  drive(nets: ArrayLike<number>, val: number): void {
    let changed = false;
    let needComb = false;
    for (let i = 0; i < nets.length; i++) {
      const n = nets[i];
      if (this.setNet(n, val)) {
        changed = true;
        if (this.readByLogic[n]) needComb = true;
      }
    }
    if (changed) this.settle(needComb);
  }
}
