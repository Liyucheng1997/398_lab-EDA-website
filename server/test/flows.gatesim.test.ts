import { afterEach, describe, expect, it } from 'vitest';
import type { GateNetlist, GatesimResult } from '@webeda/shared';
import { ASYNC_COUNTER, COUNTER, SYNTAX_ERROR } from './fixtures';
import { GateSim } from './gateEval';
import { errorsOf, runFlow, type TestContext } from './helpers';

const contexts: TestContext[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.cleanup()));
});

async function gatesim(files: Parameters<typeof runFlow>[0]['files'], options: Record<string, unknown> = {}) {
  const r = await runFlow({ kind: 'gatesim', files, options });
  contexts.push(r.ctx);
  return r as { ctx: TestContext; result?: GatesimResult; error?: Error };
}

describe('gatesim flow', { timeout: 120_000 }, () => {
  it('produces a gate netlist that simulates an async-reset counter correctly', async () => {
    const { ctx, result } = await gatesim([ASYNC_COUNTER], { params: { W: 4, NOPE: 3 } });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.top).toBe('acount');
    expect(r.netlist).toBe('gatesim.json');
    expect(r.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('NOPE'))).toBe(true);
    const n = JSON.parse(await ctx.readText('gatesim.json')) as GateNetlist;

    expect(n.ports.find((p) => p.name === 'q')!.bits.length).toBe(4);
    expect(n.combinationalLoop).toBe(false);
    expect(n.stats.flipflops).toBe(4 + 2);
    expect(n.stats.gates).toBeGreaterThan(0);
    expect(Object.values(n.netNames ?? {})).toEqual(expect.arrayContaining(['clk', 'q[0]', 'q[3]']));
    expect(n.cells.slice(0, n.stats.gates).every((c) => c.type !== 'DFF' && c.type !== 'LATCH')).toBe(true);
    // 每个 net 编号都在范围内
    for (const c of n.cells) for (const k of ['a', 'b', 's', 'y', 'd', 'q', 'clk', 'en', 'arst', 'srst'] as const) {
      const x = (c as unknown as Record<string, number | undefined>)[k];
      if (x !== undefined) expect(x).toBeLessThan(n.netCount);
    }

    const sim = new GateSim(n);
    expect(sim.get('ring_out')).toBe(0); // ring 初值 2'b01
    sim.set('en', 1);
    sim.set('rst_n', 0);
    expect(sim.get('q')).toBe(0);
    sim.set('rst_n', 1);
    for (let i = 0; i < 5; i++) sim.tick();
    expect(sim.get('q')).toBe(5);
    expect(sim.get('ring_out')).toBe(1); // 5 个时钟后 ring 旋转为 2'b10
    sim.set('en', 0);
    sim.tick();
    sim.tick();
    expect(sim.get('q')).toBe(5);
    sim.set('en', 1);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(sim.get('q')).toBe(15);
    expect(sim.get('max')).toBe(1);
    sim.tick();
    expect(sim.get('q')).toBe(0);
    expect(sim.get('max')).toBe(0);
    for (let i = 0; i < 3; i++) sim.tick();
    // 异步复位：不需要时钟沿
    sim.set('rst_n', 0);
    expect(sim.get('q')).toBe(0);
  });

  it('handles synchronous reset counters', async () => {
    const { ctx, result } = await gatesim([COUNTER]);
    expect(errorsOf(result)).toEqual([]);
    const n = JSON.parse(await ctx.readText('gatesim.json')) as GateNetlist;
    expect(n.cells.some((c) => c.type === 'DFF' && c.srst !== undefined)).toBe(true);
    const sim = new GateSim(n);
    sim.set('rst', 1);
    sim.tick();
    expect(sim.get('q')).toBe(0);
    sim.set('rst', 0);
    for (let i = 0; i < 18; i++) sim.tick();
    expect(sim.get('q')).toBe(2);
    sim.set('rst', 1);
    expect(sim.get('q')).toBe(2); // 同步复位：等待时钟沿
    sim.tick();
    expect(sim.get('q')).toBe(0);
  });

  it('maps latches', async () => {
    const latch = { name: 'l.v', content: 'module l(input en, input d, output reg q); always @* if (en) q = d; endmodule\n' };
    const { ctx, result } = await gatesim([latch]);
    expect(errorsOf(result)).toEqual([]);
    const n = JSON.parse(await ctx.readText('gatesim.json')) as GateNetlist;
    expect(n.stats.latches).toBe(1);
    const sim = new GateSim(n);
    sim.set('en', 1);
    sim.set('d', 1);
    expect(sim.get('q')).toBe(1);
    sim.set('en', 0);
    sim.set('d', 0);
    expect(sim.get('q')).toBe(1);
  });

  it('maps memories to flip-flops', async () => {
    const mem = {
      name: 'ram.v',
      content: `module ram(input clk, input we, input [1:0] a, input [3:0] d, output [3:0] q);
  reg [3:0] m [0:3];
  always @(posedge clk) if (we) m[a] <= d;
  assign q = m[a];
endmodule
`,
    };
    const { ctx, result } = await gatesim([mem]);
    expect(errorsOf(result)).toEqual([]);
    const n = JSON.parse(await ctx.readText('gatesim.json')) as GateNetlist;
    const sim = new GateSim(n);
    sim.set('we', 1);
    for (const [a, d] of [[0, 3], [1, 9], [2, 12], [3, 5]]) {
      sim.set('a', a);
      sim.set('d', d);
      sim.tick();
    }
    sim.set('we', 0);
    for (const [a, d] of [[0, 3], [1, 9], [2, 12], [3, 5]]) {
      sim.set('a', a);
      expect(sim.get('q')).toBe(d);
    }
  });

  it('rejects flip-flops with both async set and reset', async () => {
    const sr = {
      name: 'sr.v',
      content: `module sr(input clk, input s, input r, input d, output reg q);
  always @(posedge clk or posedge s or posedge r)
    if (r) q <= 0; else if (s) q <= 1; else q <= d;
endmodule
`,
    };
    const { result, error } = await gatesim([sr]);
    // dfflegalize 无法实现时由 Yosys 报错；否则转换阶段报不支持的单元
    expect(error !== undefined || errorsOf(result).length > 0).toBe(true);
  });

  it('returns Yosys diagnostics on syntax errors', async () => {
    const { result } = await gatesim([SYNTAX_ERROR]);
    expect(errorsOf(result)[0]).toMatchObject({ file: 'design.sv', line: 3 });
    expect(result!.netlist).toBe('');
  });
});
