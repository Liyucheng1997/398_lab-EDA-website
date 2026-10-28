import { afterEach, describe, expect, it } from 'vitest';
import type { SimulateResult } from '@webeda/shared';
import { COUNTER, COUNTER_TB, SYNTAX_ERROR } from './fixtures';
import { errorsOf, runFlow, type TestContext } from './helpers';

const contexts: TestContext[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.cleanup()));
});

async function sim(files: Parameters<typeof runFlow>[0]['files'], options: Record<string, unknown> = {}) {
  const r = await runFlow({ kind: 'simulate', files, options });
  contexts.push(r.ctx);
  return r as { ctx: TestContext; result?: SimulateResult; error?: Error };
}

describe('simulate flow (Icarus Verilog)', { timeout: 60_000 }, () => {
  it('runs the counter testbench and auto-injects a VCD dump', async () => {
    const { ctx, result } = await sim([COUNTER, COUNTER_TB]);
    expect(errorsOf(result)).toEqual([]);
    expect(result!.exitCode).toBe(0);
    expect(result!.timedOut).toBe(false);
    expect(result!.vcd).toBe('dump.vcd');
    expect(ctx.artifacts.find((a) => a.name === 'dump.vcd')?.kind).toBe('vcd');
    expect(ctx.logText()).toContain('q = 4');
    const vcd = await ctx.readText('dump.vcd');
    expect(vcd).toContain('$var');
    expect(vcd).toMatch(/\$scope module tb \$end/);
    expect(vcd).toMatch(/\$scope module dut \$end/);
  });

  it('uses the user $dumpfile name when present', async () => {
    const tb = {
      ...COUNTER_TB,
      content: COUNTER_TB.content.replace('initial begin', 'initial begin\n    $dumpfile("waves/out.vcd"); $dumpvars(0, tb);'),
    };
    // 子目录必须事先存在，vvp 才能创建文件
    const { ctx, result } = await sim([COUNTER, tb, { name: 'waves/keep.txt', content: '' }]);
    expect(errorsOf(result)).toEqual([]);
    expect(result!.vcd).toBe('waves/out.vcd');
    expect(ctx.artifacts.some((a) => a.name === 'dump.vcd')).toBe(false);
  });

  it('reports syntax errors with file and line and does not run', async () => {
    const { result } = await sim([SYNTAX_ERROR]);
    const errs = errorsOf(result);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatchObject({ file: 'design.sv', line: 3, tool: 'iverilog' });
    expect(result!.exitCode).toBeNull();
    expect(result!.vcd).toBeUndefined();
  });

  it('reports unknown module types', async () => {
    const tb = { name: 'tb.sv', content: 'module tb; nosuch u(); initial $finish; endmodule\n' };
    const { result } = await sim([tb]);
    expect(errorsOf(result).some((d) => /Unknown module type: nosuch/.test(d.message) && d.file === 'tb.sv' && d.line === 1)).toBe(true);
  });

  it('maps $error / $fatal runtime messages and the non-zero exit code', async () => {
    const tb = {
      name: 'tb.sv',
      content: `module tb;
  initial begin
    #1 $warning("careful");
    $error("bad value %0d", 3);
    $fatal(1, "stop here");
  end
endmodule
`,
    };
    const { result } = await sim([tb]);
    const r = result!;
    expect(r.exitCode).not.toBe(0);
    expect(r.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', file: 'tb.sv', line: 3, tool: 'vvp' }),
        expect.objectContaining({ severity: 'error', file: 'tb.sv', line: 4, message: expect.stringContaining('bad value 3') }),
        expect.objectContaining({ severity: 'error', file: 'tb.sv', line: 5, message: expect.stringContaining('stop here') }),
      ]),
    );
  });

  it('times out an endless simulation, keeps the partial VCD and warns', async () => {
    const tb = { name: 'tb.sv', content: 'module tb; reg clk = 0; always #5 clk = ~clk; endmodule\n' };
    const { ctx, result } = await sim([tb], { timeoutSec: 2 });
    expect(result!.timedOut).toBe(true);
    expect(result!.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('$finish'))).toBe(true);
    expect(errorsOf(result)).toEqual([]);
    expect(result!.vcd).toBe('dump.vcd');
    expect(ctx.artifacts.find((a) => a.name === 'dump.vcd')?.label).toContain('超时');
  });

  it('honours top, standard, defines and plusargs', async () => {
    const tb = {
      name: 'tb.sv',
      content: `module other; initial $display("other ran"); endmodule
module tb;
  integer n;
  initial begin
\`ifdef FAST
    $display("FAST defined");
\`endif
    if ($value$plusargs("N=%d", n)) $display("N is %0d", n);
    $finish;
  end
endmodule
`,
    };
    const { ctx, result } = await sim([tb], { top: 'tb', standard: '2005', compileFlags: '-DFAST -Wall', runFlags: '+N=42' });
    expect(errorsOf(result)).toEqual([]);
    const log = ctx.logText();
    expect(log).toContain('FAST defined');
    expect(log).toContain('N is 42');
    expect(log).not.toContain('other ran');
    expect(log).toContain('-g2005');
  });

  it('rejects dangerous compile and run flags without running anything', async () => {
    const { result, ctx } = await sim([COUNTER, COUNTER_TB], { compileFlags: '-o /tmp/x -m evil', runFlags: '-lxt2' });
    const errs = errorsOf(result);
    // -o、/tmp/x、-m、evil 与 -lxt2 各一条
    expect(errs.length).toBe(5);
    expect(errs.every((d) => d.tool === 'webeda')).toBe(true);
    expect(ctx.logs.some((l) => l.text.includes('▶ iverilog'))).toBe(false);
  });

  it('rejects system tasks that point outside the work directory', async () => {
    const tb = { name: 'tb.sv', content: 'module tb; integer f; initial begin f = $fopen("../../evil.txt", "w"); $finish; end endmodule\n' };
    const { result } = await sim([tb]);
    expect(errorsOf(result)[0]).toMatchObject({ file: 'tb.sv', line: 1, tool: 'webeda' });
  });

  it('compiles include files via -I without compiling them directly', async () => {
    const inc = { name: 'defs.vh', content: '`define GREETING "hello include"\n' };
    const tb = { name: 'tb.sv', content: '`include "defs.vh"\nmodule tb; initial begin $display(`GREETING); $finish; end endmodule\n' };
    const { ctx, result } = await sim([inc, tb]);
    expect(errorsOf(result)).toEqual([]);
    expect(ctx.logText()).toContain('hello include');
  });

  it('throws a FlowError when there are no HDL sources', async () => {
    const { error } = await sim([{ name: 'notes.txt', content: 'hi' }]);
    expect(error).toBeDefined();
  });
});
