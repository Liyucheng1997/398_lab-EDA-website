/** 测试用的极简 GateNetlist 求值器（按 netlist.ts 约定的语义） */
import type { CombGate, FlipFlop, GateNetlist, Latch } from '@webeda/shared';

export class GateSim {
  readonly v: Uint8Array;
  private gates: CombGate[];
  private ffs: FlipFlop[];
  private latches: Latch[];

  constructor(private n: GateNetlist) {
    this.v = new Uint8Array(n.netCount);
    this.v[1] = 1;
    this.gates = n.cells.filter((c): c is CombGate => c.type !== 'DFF' && c.type !== 'LATCH');
    this.ffs = n.cells.filter((c): c is FlipFlop => c.type === 'DFF');
    this.latches = n.cells.filter((c): c is Latch => c.type === 'LATCH');
    for (const f of this.ffs) this.v[f.q] = f.init ?? 0;
    for (const l of this.latches) this.v[l.q] = l.init ?? 0;
    this.settle();
  }

  private port(name: string) {
    const p = this.n.ports.find((x) => x.name === name);
    if (!p) throw new Error(`no port ${name}`);
    return p;
  }

  set(name: string, value: number) {
    const p = this.port(name);
    p.bits.forEach((b, i) => {
      if (b > 1) this.v[b] = (value >> i) & 1;
    });
    this.settle();
  }

  get(name: string): number {
    return this.port(name).bits.reduce((acc, b, i) => acc | (this.v[b] << i), 0);
  }

  private evalComb() {
    const v = this.v;
    for (const g of this.gates) {
      const a = v[g.a];
      const b = g.b !== undefined ? v[g.b] : 0;
      let y: number;
      switch (g.type) {
        case 'BUF': y = a; break;
        case 'NOT': y = a ^ 1; break;
        case 'AND': y = a & b; break;
        case 'OR': y = a | b; break;
        case 'XOR': y = a ^ b; break;
        case 'NAND': y = (a & b) ^ 1; break;
        case 'NOR': y = (a | b) ^ 1; break;
        case 'XNOR': y = a ^ b ^ 1; break;
        case 'ANDNOT': y = a & (b ^ 1); break;
        case 'ORNOT': y = a | (b ^ 1); break;
        case 'MUX': y = v[g.s!] ? b : a; break;
      }
      v[g.y] = y;
    }
  }

  /** 组合逻辑 + 透明锁存器 + 异步复位，迭代到稳定 */
  settle() {
    for (let iter = 0; iter < 16; iter++) {
      this.evalComb();
      let changed = false;
      for (const l of this.latches) {
        if (this.v[l.en] === l.enPol && this.v[l.q] !== this.v[l.d]) {
          this.v[l.q] = this.v[l.d];
          changed = true;
        }
      }
      for (const f of this.ffs) {
        if (f.arst !== undefined && this.v[f.arst] === f.arstPol && this.v[f.q] !== f.arstVal) {
          this.v[f.q] = f.arstVal!;
          changed = true;
        }
      }
      if (!changed) return;
    }
  }

  /** 设置时钟输入的值，触发对应边沿的触发器 */
  setClock(name: string, value: 0 | 1) {
    const net = this.port(name).bits[0];
    const prev = this.v[net];
    if (prev === value) return;
    this.v[net] = value;
    this.evalComb();
    const next: [FlipFlop, number][] = [];
    for (const f of this.ffs) {
      if (f.clk !== net || value !== f.clkPol) continue;
      let q = this.v[f.q];
      if (f.arst !== undefined && this.v[f.arst] === f.arstPol) q = f.arstVal!;
      else if (f.srst !== undefined && this.v[f.srst] === f.srstPol) q = f.srstVal!;
      else if (f.en === undefined || this.v[f.en] === f.enPol) q = this.v[f.d];
      next.push([f, q]);
    }
    for (const [f, q] of next) this.v[f.q] = q;
    this.settle();
  }

  tick(clk = 'clk') {
    this.setClock(clk, 1);
    this.setClock(clk, 0);
  }
}
