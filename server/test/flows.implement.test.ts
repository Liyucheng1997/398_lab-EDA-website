import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImplementResult, PlacementInfo } from '@webeda/shared';
import { BLINKY, ICEBREAKER_PCF, SYNTAX_ERROR } from './fixtures';
import { errorsOf, runFlow, type TestContext } from './helpers';

const contexts: TestContext[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.cleanup()));
});

async function impl(files: Parameters<typeof runFlow>[0]['files'], options: Record<string, unknown>) {
  const r = await runFlow({ kind: 'implement', files, options } as unknown as Parameters<typeof runFlow>[0]);
  contexts.push(r.ctx);
  return r as { ctx: TestContext; result?: ImplementResult; error?: Error };
}

const row = (r: ImplementResult, name: string) => r.utilization.rows.find((x) => x.resource === name);

describe('implement flow', { timeout: 240_000 }, () => {
  it('iCEBreaker blinky: synth → nextpnr-ice40 → icepack', async () => {
    const { ctx, result } = await impl([BLINKY, ICEBREAKER_PCF], {
      device: 'ice40-up5k-sg48',
      constraintFile: 'icebreaker.pcf',
      freqMHz: 12,
      seed: 1,
    });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.top).toBe('top');
    expect(r.device).toBe('ice40-up5k-sg48');
    expect(r.stages.map((s) => `${s.name}:${s.ok}`)).toEqual(['synth:true', 'pnr:true', 'bitstream:true']);
    expect(r.stages.every((s) => s.durationMs >= 0)).toBe(true);

    // 时序
    expect(r.timing.clocks).toHaveLength(1);
    const clk = r.timing.clocks[0];
    expect(clk.clock).toBe('clk');
    expect(clk.constraintMHz).toBe(12);
    expect(clk.achievedMHz).toBeGreaterThan(12);
    expect(clk.passed).toBe(true);
    expect(clk.slackNs).toBeCloseTo(1000 / 12 - 1000 / clk.achievedMHz, 2);
    expect(r.timing.criticalPaths.length).toBeGreaterThan(0);
    const p = r.timing.criticalPaths[0];
    expect(p.steps.length).toBeGreaterThan(1);
    expect(p.totalDelayNs).toBeGreaterThan(0);
    expect(p.steps.some((s) => s.source?.startsWith('blinky.v:'))).toBe(true);

    // 布局后利用率覆盖综合估算
    expect(row(r, 'LC')!.available).toBe(5280);
    expect(row(r, 'LC')!.used).toBeGreaterThan(20);
    expect(row(r, 'IO')).toEqual({ resource: 'IO', used: 3, available: 39 });
    expect(row(r, 'GB')!.used).toBe(1);

    // 产物
    expect(r.bitstream).toBe('out.bin');
    expect(ctx.artifacts.find((a) => a.name === 'out.bin')?.kind).toBe('bitstream');
    const bin = await fs.stat(path.join(ctx.workDir, 'out.bin'));
    expect(bin.size).toBeGreaterThan(100_000);
    expect(ctx.artifacts.map((a) => a.name)).toEqual(expect.arrayContaining(['synth.json', 'report.json', 'placement.json', 'out.asc', 'out.bin']));

    // 布局信息：引脚 35/11/37 对应的 IO 位于器件边缘
    expect(r.placement).toBe('placement.json');
    const pl = JSON.parse(await ctx.readText('placement.json')) as PlacementInfo;
    expect(pl.device).toBe('ice40-up5k-sg48');
    expect(pl.width).toBe(26);
    expect(pl.height).toBe(32);
    const io = pl.cells.filter((c) => c.type === 'IO');
    expect(io).toHaveLength(3);
    expect(io.every((c) => c.y === 0 || c.y === pl.height - 1 || c.x === 0 || c.x === pl.width - 1)).toBe(true);
    expect(pl.cells.filter((c) => c.type === 'LC').length).toBeGreaterThan(20);
    expect(pl.cells.some((c) => c.type === 'GB')).toBe(true);
    expect(pl.wires!.length).toBeGreaterThan(0);
    expect(pl.wires!.length).toBeLessThanOrEqual(5000);
  });

  it('ECP5 blinky without constraints still succeeds and produces a .bit', async () => {
    const { ctx, result } = await impl([BLINKY], { device: 'ecp5-25k-cabga256', freqMHz: 50 });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.diagnostics.some((d) => d.severity === 'info' && d.message.includes('.lpf'))).toBe(true);
    expect(r.timing.clocks[0]).toMatchObject({ clock: 'clk', constraintMHz: 50, passed: true });
    expect(r.bitstream).toBe('out.bit');
    expect(row(r, 'LUT4')!.available).toBe(24288);
    expect(row(r, 'FF')!.used).toBe(24);
    const pl = JSON.parse(await ctx.readText('placement.json')) as PlacementInfo;
    expect(pl.cells.some((c) => c.type === 'SLICE')).toBe(true);
    expect(pl.width).toBeGreaterThanOrEqual(73);
  });

  it('warns (but succeeds) when timing fails, and can skip the bitstream', async () => {
    const { result } = await impl([BLINKY], { device: 'ice40-hx1k-tq144', freqMHz: 400, bitstream: false });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.timing.clocks[0].passed).toBe(false);
    expect(r.timing.clocks[0].slackNs).toBeLessThan(0);
    expect(r.diagnostics.some((d) => d.severity === 'warning' && d.message.startsWith('时序未满足：clk 达到'))).toBe(true);
    expect(r.stages.map((s) => s.name)).toEqual(['synth', 'pnr']);
    expect(r.bitstream).toBeUndefined();
  });

  it('refuses devices without place & route support', async () => {
    const { error } = await impl([BLINKY], { device: 'xc7a35t-cpg236' });
    expect(error?.message).toMatch(/只能做综合/);
  });

  it('rejects a constraint file of the wrong format', async () => {
    const lpf = { name: 'board.lpf', content: 'LOCATE COMP "clk" SITE "P3";\n' };
    const { error } = await impl([BLINKY, lpf], { device: 'ice40-up5k-sg48', constraintFile: 'board.lpf' });
    expect(error?.message).toMatch(/\.pcf/);
  });

  it('reports nextpnr errors for impossible pin constraints', async () => {
    const pcf = { name: 'bad.pcf', content: 'set_io clk 999\n' };
    const { result } = await impl([BLINKY, pcf], { device: 'ice40-up5k-sg48' });
    const r = result!;
    expect(errorsOf(r).some((d) => d.tool === 'nextpnr')).toBe(true);
    expect(r.stages.find((s) => s.name === 'pnr')?.ok).toBe(false);
    expect(r.bitstream).toBeUndefined();
  });

  it('stops after synthesis errors', async () => {
    const { result } = await impl([SYNTAX_ERROR], { device: 'ice40-up5k-sg48' });
    expect(result!.stages).toEqual([expect.objectContaining({ name: 'synth', ok: false })]);
    expect(errorsOf(result)[0]).toMatchObject({ file: 'design.sv', line: 3 });
  });
});
