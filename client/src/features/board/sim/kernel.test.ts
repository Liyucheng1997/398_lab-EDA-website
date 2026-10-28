import { describe, expect, it } from 'vitest';
import type { GateNetlist, GateType } from '@webeda/shared';
import { NetlistError, Simulator, validateNetlist } from './kernel';
import { NetlistBuilder, readBits } from './testing';

const MODES = [
  ['compiled', false],
  ['interpreted', true],
] as const;

function clock(sim: Simulator, clk: number, n = 1) {
  for (let i = 0; i < n; i++) {
    sim.setNet(clk, 0);
    sim.settle();
    sim.setNet(clk, 1);
    sim.settle();
  }
}

function set(sim: Simulator, net: number, v: number) {
  sim.setNet(net, v);
  sim.settle();
}

describe.each(MODES)('Simulator (%s)', (_label, interpret) => {
  const opts = { interpret };

  it('evaluates every gate type', () => {
    const table: Record<GateType, (a: number, b: number, s: number) => number> = {
      BUF: (a) => a,
      NOT: (a) => a ^ 1,
      AND: (a, b) => a & b,
      OR: (a, b) => a | b,
      XOR: (a, b) => a ^ b,
      NAND: (a, b) => (a & b) ^ 1,
      NOR: (a, b) => (a | b) ^ 1,
      XNOR: (a, b) => a ^ b ^ 1,
      ANDNOT: (a, b) => a & (b ^ 1),
      ORNOT: (a, b) => a | (b ^ 1),
      MUX: (a, b, s) => (s ? b : a),
    };
    const nb = new NetlistBuilder();
    const [a, b, s] = [nb.input('a')[0], nb.input('b')[0], nb.input('s')[0]];
    const outs = (Object.keys(table) as GateType[]).map((t) => [t, nb.gate(t, a, b, s)] as const);
    const sim = new Simulator(nb.build(), opts);
    expect(sim.compiled).toBe(!interpret);
    for (let x = 0; x < 8; x++) {
      const [va, vb, vs] = [x & 1, (x >> 1) & 1, (x >> 2) & 1];
      sim.setNet(a, va);
      sim.setNet(b, vb);
      sim.setNet(s, vs);
      sim.settle();
      for (const [t, y] of outs) expect(sim.get(y), `${t}(${va},${vb},${vs})`).toBe(table[t](va, vb, vs));
    }
  });

  it('evaluates a 4:1 mux tree exhaustively', () => {
    const nb = new NetlistBuilder();
    const d = nb.input('d', 4);
    const sel = nb.input('sel', 2);
    const m0 = nb.mux(sel[0], d[0], d[1]);
    const m1 = nb.mux(sel[0], d[2], d[3]);
    const y = nb.mux(sel[1], m0, m1);
    nb.output('y', [y]);
    const sim = new Simulator(nb.build(), opts);
    for (let dv = 0; dv < 16; dv++) {
      for (let sv = 0; sv < 4; sv++) {
        d.forEach((n, i) => sim.setNet(n, (dv >> i) & 1));
        sel.forEach((n, i) => sim.setNet(n, (sv >> i) & 1));
        sim.settle();
        expect(sim.get(y)).toBe((dv >> sv) & 1);
      }
    }
  });

  it('counts with async reset (applied without a clock edge)', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const [rst] = nb.input('rst');
    const q = nb.counter(4, clk, { arst: rst, arstPol: 1, arstVal: 0 });
    const sim = new Simulator(nb.build(), opts);
    expect(readBits(sim.v, q)).toBe(0);
    clock(sim, clk, 5);
    expect(readBits(sim.v, q)).toBe(5);
    // 异步复位：不需要时钟沿
    set(sim, rst, 1);
    expect(readBits(sim.v, q)).toBe(0);
    clock(sim, clk, 3);
    expect(readBits(sim.v, q)).toBe(0);
    set(sim, rst, 0);
    clock(sim, clk, 18);
    expect(readBits(sim.v, q)).toBe(18 % 16);
  });

  it('honours async set value and active-low polarity', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const [rstn] = nb.input('rst_n');
    const [d] = nb.input('d');
    const q = nb.dff({ clk, d, arst: rstn, arstPol: 0, arstVal: 1 });
    const sim = new Simulator(nb.build(), opts);
    // rst_n = 0 → 置位
    expect(sim.get(q)).toBe(1);
    set(sim, rstn, 1);
    clock(sim, clk);
    expect(sim.get(q)).toBe(0);
    set(sim, rstn, 0);
    expect(sim.get(q)).toBe(1);
  });

  it('respects clock enable', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const [en] = nb.input('en');
    const q = nb.counter(3, clk, { en, enPol: 1 });
    const sim = new Simulator(nb.build(), opts);
    clock(sim, clk, 4);
    expect(readBits(sim.v, q)).toBe(0);
    set(sim, en, 1);
    clock(sim, clk, 3);
    expect(readBits(sim.v, q)).toBe(3);
    set(sim, en, 0);
    clock(sim, clk, 3);
    expect(readBits(sim.v, q)).toBe(3);
  });

  it('gives sync reset priority over enable and only acts on an edge', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const [en] = nb.input('en');
    const [srst] = nb.input('srst');
    const q = nb.counter(3, clk, { en, enPol: 1, srst, srstPol: 1, srstVal: 0 });
    // 另一个同步置位到 1、低有效使能的 FF
    const [d] = nb.input('d');
    const q2 = nb.dff({ clk, d, en, enPol: 0, srst, srstPol: 1, srstVal: 1 });
    const sim = new Simulator(nb.build(), opts);
    set(sim, en, 1);
    clock(sim, clk, 5);
    expect(readBits(sim.v, q)).toBe(5);
    set(sim, en, 0);
    set(sim, srst, 1);
    // 没有时钟沿 → 不变
    expect(readBits(sim.v, q)).toBe(5);
    expect(sim.get(q2)).toBe(0);
    clock(sim, clk);
    // srst 优先于 en=0
    expect(readBits(sim.v, q)).toBe(0);
    expect(sim.get(q2)).toBe(1);
    set(sim, srst, 0);
    // q2：enPol=0、en=0 → 使能有效，跟随 d=0
    clock(sim, clk);
    expect(sim.get(q2)).toBe(0);
  });

  it('triggers negedge flip-flops only on falling edges', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const q = nb.net();
    const d = nb.not(q);
    nb.dff({ clk, d, q, clkPol: 0 });
    const sim = new Simulator(nb.build(), opts);
    set(sim, clk, 1);
    expect(sim.get(q)).toBe(0);
    set(sim, clk, 0);
    expect(sim.get(q)).toBe(1);
    set(sim, clk, 1);
    expect(sim.get(q)).toBe(1);
    set(sim, clk, 0);
    expect(sim.get(q)).toBe(0);
  });

  it('does not create an edge at power-up and uses init values', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const q = nb.net();
    const d = nb.not(q);
    nb.dff({ clk, d, q, init: 1 });
    const lq = nb.latch({ en: 0, enPol: 1, d: 1, init: 1 });
    const sim = new Simulator(nb.build(), opts);
    expect(sim.get(q)).toBe(1);
    expect(sim.get(lq)).toBe(1);
    sim.reset([[clk, 1]]);
    expect(sim.get(q)).toBe(1);
    set(sim, clk, 0);
    set(sim, clk, 1);
    expect(sim.get(q)).toBe(0);
  });

  it('models transparent latches with either enable polarity', () => {
    const nb = new NetlistBuilder();
    const [en] = nb.input('en');
    const [d] = nb.input('d');
    const q = nb.latch({ en, enPol: 1, d });
    const qn = nb.latch({ en, enPol: 0, d });
    const y = nb.not(q); // 锁存器输出驱动组合逻辑
    const sim = new Simulator(nb.build(), opts);
    set(sim, en, 1);
    set(sim, d, 1);
    expect(sim.get(q)).toBe(1);
    expect(sim.get(y)).toBe(0);
    expect(sim.get(qn)).toBe(0); // en=1 时 qn 保持
    set(sim, en, 0);
    set(sim, d, 0);
    expect(sim.get(q)).toBe(1); // 保持
    expect(sim.get(qn)).toBe(0); // 透明
    set(sim, d, 1);
    expect(sim.get(qn)).toBe(1);
  });

  it('samples all flip-flops before updating any (two-phase shift register)', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const [din] = nb.input('din');
    const q0 = nb.dff({ clk, d: din });
    const q1 = nb.dff({ clk, d: q0 });
    const q2 = nb.dff({ clk, d: q1 });
    const sim = new Simulator(nb.build(), opts);
    set(sim, din, 1);
    clock(sim, clk);
    expect([sim.get(q0), sim.get(q1), sim.get(q2)]).toEqual([1, 0, 0]);
    set(sim, din, 0);
    clock(sim, clk);
    expect([sim.get(q0), sim.get(q1), sim.get(q2)]).toEqual([0, 1, 0]);
    clock(sim, clk);
    expect([sim.get(q0), sim.get(q1), sim.get(q2)]).toEqual([0, 0, 1]);
  });

  it('handles ripple counters with logic-derived clocks', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const q: number[] = [];
    let c = clk;
    for (let i = 0; i < 4; i++) {
      const qi = nb.net();
      const nq = nb.not(qi);
      nb.dff({ clk: c, d: nq, q: qi });
      q.push(qi);
      c = nq; // 下一级在本级 Q 的下降沿（~Q 上升沿）翻转
    }
    const sim = new Simulator(nb.build(), opts);
    for (let n = 1; n <= 20; n++) {
      clock(sim, clk);
      expect(readBits(sim.v, q)).toBe(n % 16);
    }
  });

  it('handles flip-flops clocked directly by another flip-flop output (clock divider)', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const div = nb.net();
    nb.dff({ clk, d: nb.not(div), q: div });
    const cnt = nb.counter(3, div);
    const sim = new Simulator(nb.build(), opts);
    clock(sim, clk, 10);
    expect(readBits(sim.v, cnt)).toBe(5);
  });

  it('treats a button input as a clock (edge on input change)', () => {
    const nb = new NetlistBuilder();
    const [btn] = nb.input('btn');
    const cnt = nb.counter(4, btn);
    const sim = new Simulator(nb.build(), opts);
    for (let i = 0; i < 3; i++) {
      set(sim, btn, 1);
      set(sim, btn, 0);
    }
    expect(readBits(sim.v, cnt)).toBe(3);
  });

  it('resolves a stable combinational loop (NOR SR latch)', () => {
    const nb = new NetlistBuilder();
    const [s] = nb.input('s');
    const [r] = nb.input('r');
    const q = nb.net();
    const qb = nb.net();
    nb.gate('NOR', r, qb, undefined, q);
    nb.gate('NOR', s, q, undefined, qb);
    nb.combinationalLoop = true;
    const sim = new Simulator(nb.build(), opts);
    set(sim, s, 1);
    expect([sim.get(q), sim.get(qb)]).toEqual([1, 0]);
    set(sim, s, 0);
    expect([sim.get(q), sim.get(qb)]).toEqual([1, 0]);
    set(sim, r, 1);
    expect([sim.get(q), sim.get(qb)]).toEqual([0, 1]);
    set(sim, r, 0);
    expect([sim.get(q), sim.get(qb)]).toEqual([0, 1]);
    expect(sim.oscillating).toBe(false);
  });

  it('evaluates unsorted gates in loop mode by iteration', () => {
    const nb = new NetlistBuilder();
    const [a] = nb.input('a');
    const y2 = nb.net();
    const y1 = nb.net();
    nb.not(y1, y2); // 先于其输入的产生者
    nb.not(a, y1);
    nb.combinationalLoop = true;
    const sim = new Simulator(nb.build(), opts);
    set(sim, a, 1);
    expect(sim.get(y2)).toBe(1);
    set(sim, a, 0);
    expect(sim.get(y2)).toBe(0);
    expect(sim.oscillating).toBe(false);
  });

  it('flags oscillation of a ring oscillator without hanging', () => {
    const nb = new NetlistBuilder();
    const [en] = nb.input('en');
    const y = nb.net();
    const n1 = nb.gate('NAND', en, y);
    nb.not(nb.not(n1), y);
    nb.combinationalLoop = true;
    const sim = new Simulator(nb.build(), opts);
    expect(sim.oscillating).toBe(false);
    set(sim, en, 1);
    expect(sim.oscillating).toBe(true);
    sim.reset();
    expect(sim.oscillating).toBe(false);
  });

  it('skips logic evaluation when a driven clock feeds only flip-flops', () => {
    const nb = new NetlistBuilder();
    const [clk] = nb.input('clk');
    const q = nb.counter(8, clk);
    const sim = new Simulator(nb.build(), opts);
    const before = sim.gateEvals;
    for (let i = 0; i < 10; i++) {
      sim.drive([clk], 0);
      sim.drive([clk], 1);
    }
    expect(readBits(sim.v, q)).toBe(10);
    // 每周期只求值一次（上升沿写回后）
    expect(sim.gateEvals - before).toBe(10 * sim.combGateCount);
  });
});

describe('validateNetlist', () => {
  it('rejects out-of-range nets and unknown types', () => {
    const base: GateNetlist = {
      top: 't',
      netCount: 3,
      ports: [],
      cells: [],
      combinationalLoop: false,
      stats: { gates: 0, flipflops: 0, latches: 0 },
    };
    expect(validateNetlist(base)).toBeNull();
    expect(validateNetlist({ ...base, netCount: 1 })).toMatch(/netCount/);
    expect(validateNetlist({ ...base, cells: [{ type: 'AND', a: 0, b: 7, y: 2 }] })).toMatch(/无效/);
    expect(validateNetlist({ ...base, cells: [{ type: 'AND', a: 0, y: 2 }] })).toMatch(/缺少/);
    expect(validateNetlist({ ...base, cells: [{ type: 'FOO' as GateType, a: 0, y: 2 }] })).toMatch(/未知/);
    expect(validateNetlist({ ...base, ports: [{ name: 'x', direction: 'input', bits: [9] }] })).toMatch(/x/);
    expect(() => new Simulator({ ...base, netCount: 0 })).toThrow(NetlistError);
  });

  it('ignores gates that would drive constant nets', () => {
    const nl: GateNetlist = {
      top: 't',
      netCount: 3,
      ports: [{ name: 'a', direction: 'input', bits: [2] }],
      cells: [{ type: 'BUF', a: 2, y: 0 }],
      combinationalLoop: false,
      stats: { gates: 1, flipflops: 0, latches: 0 },
    };
    const sim = new Simulator(nl);
    sim.setNet(2, 1);
    sim.settle();
    expect(sim.get(0)).toBe(0);
    expect(sim.get(1)).toBe(1);
  });
});

/** 随机网表：若干层组合逻辑 + 寄存器 */
function randomNetlist(seed: number, gates: number, ffCount: number, inputs = 8) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const nb = new NetlistBuilder();
  const [clk] = nb.input('clk');
  const ins = nb.input('in', inputs);
  const ffq = nb.nets(ffCount);
  const pool = [...ins, ...ffq, 0, 1];
  const types: GateType[] = ['BUF', 'NOT', 'AND', 'OR', 'XOR', 'NAND', 'NOR', 'XNOR', 'ANDNOT', 'ORNOT', 'MUX'];
  for (let i = 0; i < gates; i++) {
    const t = types[Math.floor(rnd() * types.length)];
    const pick = () => pool[Math.floor(rnd() * pool.length)];
    pool.push(nb.gate(t, pick(), pick(), pick()));
  }
  const tail = pool.slice(-Math.max(ffCount, 16));
  ffq.forEach((q, i) => nb.dff({ clk, d: tail[i % tail.length], q, clkPol: i % 5 === 0 ? 0 : 1 }));
  nb.output('out', pool.slice(-16));
  return { nl: nb.build(), clk, ins, outs: pool.slice(-16) };
}

describe('compiled vs interpreted', () => {
  it('produce identical traces on random netlists', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { nl, clk, ins, outs } = randomNetlist(seed, 600, 40);
      const a = new Simulator(nl);
      const b = new Simulator(nl, { interpret: true });
      expect(a.compiled).toBe(true);
      expect(b.compiled).toBe(false);
      for (let c = 0; c < 60; c++) {
        const iv = (c * 2654435761) >>> 0;
        ins.forEach((n, i) => {
          a.setNet(n, (iv >> i) & 1);
          b.setNet(n, (iv >> i) & 1);
        });
        for (const sim of [a, b]) {
          sim.settle();
          sim.drive([clk], 0);
          sim.drive([clk], 1);
        }
        expect(readBits(a.v, outs)).toBe(readBits(b.v, outs));
      }
      expect(Array.from(a.v)).toEqual(Array.from(b.v));
    }
  });
});

describe('performance', () => {
  it('reaches >= 5M gate-evals/s on a 2k-gate design', () => {
    const { nl, clk } = randomNetlist(42, 2000, 200);
    const sim = new Simulator(nl);
    const t0 = performance.now();
    let cycles = 0;
    while (performance.now() - t0 < 300) {
      for (let i = 0; i < 200; i++) {
        sim.drive([clk], 0);
        sim.drive([clk], 1);
      }
      cycles += 200;
    }
    const dt = (performance.now() - t0) / 1000;
    const rate = sim.gateEvals / dt;
    // 控制台记录便于观察
    console.log(`2k gates: ${(cycles / dt / 1e3).toFixed(1)} k cycles/s, ${(rate / 1e6).toFixed(1)} M gate-evals/s`);
    expect(rate).toBeGreaterThan(5e6);
  });
});
