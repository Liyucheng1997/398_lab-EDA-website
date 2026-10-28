/** elaborate / synthesize / yosys 控制台：真实 Yosys（WASM） + netlistsvg */
import { afterEach, describe, expect, it } from 'vitest';
import type { ElaborateResult, HierarchyNode, JobRequest, SynthesizeResult, YosysResult } from '@webeda/shared';
import { COUNTER, COUNTER_TB, HIER, SYNTAX_ERROR } from './fixtures';
import { errorsOf, runFlow, type TestContext } from './helpers';

const contexts: TestContext[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.cleanup()));
});

async function go<T>(req: JobRequest) {
  const r = await runFlow(req);
  contexts.push(r.ctx);
  return r as unknown as { ctx: TestContext; result?: T; error?: Error };
}

const row = (r: SynthesizeResult, name: string) => r.utilization.rows.find((x) => x.resource === name);

describe('elaborate flow', { timeout: 120_000 }, () => {
  it('builds the hierarchy and renders schematics for every module', async () => {
    const { ctx, result } = await go<ElaborateResult>({ kind: 'elaborate', files: HIER, options: {} });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.top).toBe('top');
    const kids = r.hierarchy.children.map((c: HierarchyNode) => `${c.instance}:${c.module}`).sort();
    expect(kids).toEqual(['u_add:adder(W=8)', 'u_mux:mux2', 'u_small:adder(W=4)']);
    expect(Object.keys(r.schematics).sort()).toEqual(['adder(W=4)', 'adder(W=8)', 'mux2', 'top']);
    for (const name of Object.values(r.schematics)) {
      const a = ctx.artifacts.find((x) => x.name === name)!;
      expect(a.kind).toBe('svg');
      const svg = await ctx.readText(name);
      expect(svg.startsWith('<svg')).toBe(true);
    }
    expect(ctx.artifacts.some((a) => a.name === 'rtl.json')).toBe(true);
  });

  it('flattens on request and only draws the top', async () => {
    const { result } = await go<ElaborateResult>({ kind: 'elaborate', files: HIER, options: { top: 'top', flatten: true } });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.hierarchy.children.length).toBe(3);
    expect(Object.keys(r.schematics)).toEqual(['top']);
  });

  it('ignores testbench files and reports Yosys syntax errors with location', async () => {
    const { result } = await go<ElaborateResult>({ kind: 'elaborate', files: [SYNTAX_ERROR, COUNTER_TB], options: {} });
    const errs = errorsOf(result);
    expect(errs[0]).toMatchObject({ tool: 'yosys', file: 'design.sv', line: 3 });
    expect(result!.schematics).toEqual({});
  });

  it('reports a missing submodule', async () => {
    const files = [{ name: 'top.v', content: 'module top(input a, output y); missing u0(.a(a), .y(y)); endmodule\n' }];
    const { result } = await go<ElaborateResult>({ kind: 'elaborate', files, options: { top: 'top' } });
    expect(errorsOf(result).some((d) => /missing/.test(d.message))).toBe(true);
  });
});

describe('synthesize flow', { timeout: 180_000 }, () => {
  it('generic synthesis reports gates, FF and a schematic', async () => {
    const { ctx, result } = await go<SynthesizeResult>({ kind: 'synthesize', files: [COUNTER, COUNTER_TB], options: { target: 'generic' } });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.top).toBe('counter');
    expect(row(r, 'FF')).toEqual({ resource: 'FF', used: 4, available: null });
    expect(row(r, 'IO')?.used).toBe(6);
    expect(r.utilization.cells['$_SDFF_PP0_'] ?? r.utilization.cells['$_DFF_P_']).toBeGreaterThan(0);
    expect(r.netlist).toBe('synth.json');
    expect(r.schematic).toBe('synth_schematic.svg');
    expect((await ctx.readText('synth_schematic.svg')).startsWith('<svg')).toBe(true);
    expect(ctx.artifacts.map((a) => a.name)).toEqual(expect.arrayContaining(['synth.json', 'stat.txt', 'synth_schematic.svg']));
  });

  it('ice40 synthesis maps cells to LUT4/FF/CARRY/LC with device totals', async () => {
    const { result } = await go<SynthesizeResult>({
      kind: 'synthesize',
      files: [COUNTER],
      options: { target: 'ice40', device: 'ice40-up5k-sg48', schematic: false },
    });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.utilization.device).toBe('ice40-up5k-sg48');
    expect(row(r, 'FF')).toEqual({ resource: 'FF', used: 4, available: 5280 });
    expect(row(r, 'LUT4')!.used).toBeGreaterThan(0);
    expect(row(r, 'LC')!.used).toBeGreaterThanOrEqual(4);
    expect(row(r, 'IO')).toEqual({ resource: 'IO', used: 6, available: 39 });
    expect(r.schematic).toBeUndefined();
  });

  it('hierarchical xc7 synthesis keeps per-module counts and uses the first xc7 device', async () => {
    const { result } = await go<SynthesizeResult>({
      kind: 'synthesize',
      files: HIER,
      options: { target: 'xc7', top: 'top', device: 'ice40-up5k-sg48', schematic: false },
    });
    const r = result!;
    expect(errorsOf(r)).toEqual([]);
    expect(r.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('Xilinx'))).toBe(true);
    expect(r.utilization.device).toBe('xc7a35t-cpg236');
    expect(row(r, 'LUT6')!.available).toBe(20800);
    expect(row(r, 'FF')!.used).toBe(9);
    expect(row(r, 'IO')!.used).toBeGreaterThan(0);
  });

  it('ecp5 and gowin targets produce rows', async () => {
    for (const target of ['ecp5', 'gowin'] as const) {
      const { result } = await go<SynthesizeResult>({ kind: 'synthesize', files: [COUNTER], options: { target, schematic: false } });
      expect(errorsOf(result)).toEqual([]);
      expect(row(result!, 'FF')!.used).toBe(4);
      expect(row(result!, 'LUT4')!.available).toBeGreaterThan(0);
    }
  });

  it('returns diagnostics and an empty report on syntax errors', async () => {
    const { result } = await go<SynthesizeResult>({ kind: 'synthesize', files: [SYNTAX_ERROR], options: { target: 'ice40' } });
    expect(errorsOf(result).length).toBeGreaterThan(0);
    expect(result!.utilization.rows).toEqual([]);
    expect(result!.netlist).toBe('');
  });
});

describe('yosys console flow', { timeout: 60_000 }, () => {
  it('runs a script and registers files it writes', async () => {
    const script = `# comment
read_verilog -sv design.sv
synth -top counter; stat
write_verilog -noattr out.v
tee -q -o report.txt stat
write_json net.json
`;
    const { ctx, result } = await go<YosysResult>({ kind: 'yosys', files: [COUNTER], options: { script } });
    const r = result!;
    expect(r.exitCode).toBe(0);
    expect(errorsOf(r)).toEqual([]);
    const names = ctx.artifacts.map((a) => `${a.name}:${a.kind}`).sort();
    expect(names).toEqual(['net.json:json', 'out.v:verilog', 'report.txt:text', 'yosys.log:text']);
    expect(ctx.logText()).toContain('$_SDFF_PP0_');
  });

  it('reports script errors with a non-zero exit code', async () => {
    const { result } = await go<YosysResult>({ kind: 'yosys', files: [COUNTER], options: { script: 'read_verilog nosuch.v\n' } });
    expect(result!.exitCode).not.toBe(0);
    expect(errorsOf(result).length).toBeGreaterThan(0);
  });

  it('rejects shell escapes and paths outside the work directory', async () => {
    for (const script of ['!ls', 'shell ls', 'read_verilog design.sv; write_json /tmp/x.json', 'tee -o ../x.txt stat']) {
      const { result, ctx } = await go<YosysResult>({ kind: 'yosys', files: [COUNTER], options: { script } });
      expect(result!.exitCode).toBe(-1);
      expect(errorsOf(result)[0].tool).toBe('webeda');
      expect(ctx.logs.some((l) => l.text.includes('▶ yosys'))).toBe(false);
    }
  });
});
