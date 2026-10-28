/** 测试用：手工搭建门级网表 */
import type { CombGate, FlipFlop, GateCell, GateNetlist, GatePort, GateType, Latch } from '@webeda/shared';

export class NetlistBuilder {
  private n = 2;
  readonly cells: GateCell[] = [];
  readonly ports: GatePort[] = [];
  combinationalLoop = false;

  net(): number {
    return this.n++;
  }
  nets(k: number): number[] {
    return Array.from({ length: k }, () => this.net());
  }
  input(name: string, width = 1): number[] {
    const bits = this.nets(width);
    this.ports.push({ name, direction: 'input', bits });
    return bits;
  }
  output(name: string, bits: number[]): void {
    this.ports.push({ name, direction: 'output', bits });
  }
  gate(type: GateType, a: number, b?: number, s?: number, y = this.net()): number {
    const g: CombGate = { type, a, y };
    if (b !== undefined) g.b = b;
    if (s !== undefined) g.s = s;
    this.cells.push(g);
    return y;
  }
  buf(a: number, y?: number) {
    return this.gate('BUF', a, undefined, undefined, y);
  }
  not(a: number, y?: number) {
    return this.gate('NOT', a, undefined, undefined, y);
  }
  and(a: number, b: number) {
    return this.gate('AND', a, b);
  }
  or(a: number, b: number) {
    return this.gate('OR', a, b);
  }
  xor(a: number, b: number) {
    return this.gate('XOR', a, b);
  }
  /** Y = s ? b : a */
  mux(s: number, a: number, b: number) {
    return this.gate('MUX', a, b, s);
  }
  dff(opts: Omit<FlipFlop, 'type' | 'q' | 'clkPol'> & { q?: number; clkPol?: 0 | 1 }): number {
    const q = opts.q ?? this.net();
    this.cells.push({ type: 'DFF', clkPol: 1, ...opts, q });
    return q;
  }
  latch(opts: Omit<Latch, 'type' | 'q'> & { q?: number }): number {
    const q = opts.q ?? this.net();
    this.cells.push({ type: 'LATCH', ...opts, q });
    return q;
  }
  /** 加法器：q + 1，返回 d 网络（组合门按拓扑序追加） */
  increment(q: number[]): number[] {
    const d: number[] = [];
    let carry = 1;
    for (const b of q) {
      d.push(carry === 1 ? this.not(b) : this.xor(b, carry));
      carry = carry === 1 ? b : this.and(b, carry);
    }
    return d;
  }
  /** n 位计数器（D 网络在 FF 之后追加，组合门仍为拓扑序：FF 输出是源） */
  counter(width: number, clk: number, extra: Partial<Omit<FlipFlop, 'type' | 'q' | 'd' | 'clk'>> = {}): number[] {
    const q = this.nets(width);
    const d = this.increment(q);
    q.forEach((qq, i) => this.dff({ clk, d: d[i], q: qq, ...extra }));
    return q;
  }
  build(top = 'top'): GateNetlist {
    let gates = 0;
    let flipflops = 0;
    let latches = 0;
    for (const c of this.cells) {
      if (c.type === 'DFF') flipflops++;
      else if (c.type === 'LATCH') latches++;
      else gates++;
    }
    return {
      top,
      netCount: this.n,
      ports: this.ports,
      cells: this.cells,
      combinationalLoop: this.combinationalLoop,
      stats: { gates, flipflops, latches },
    };
  }
}

/** 读多位值（LSB 在前） */
export function readBits(v: Uint8Array, bits: number[]): number {
  let x = 0;
  for (let i = 0; i < bits.length; i++) x |= v[bits[i]] << i;
  return x;
}
