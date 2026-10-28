import { describe, expect, it } from 'vitest';
import { findTopCandidates, moduleParams, scanFiles, scanSource, stripComments, unsafePathRefs } from '../src/flows/verilogScan';

describe('stripComments', () => {
  it('removes comments, keeps strings and line numbers', () => {
    const src = 'a // x "y"\nb /* c\nd */ e "f // g /* h */"\n';
    const out = stripComments(src);
    expect(out.split('\n')).toHaveLength(4);
    expect(out).toContain('"f // g /* h */"');
    expect(out).not.toContain('x "y"');
    expect(out).not.toMatch(/\bc\b/);
    expect(out).toMatch(/\be\b/);
  });
});

describe('scanSource', () => {
  it('finds modules, instantiations (with parameters, arrays and multiple instances) and parameters', () => {
    const src = `
\`timescale 1ns/1ps
\`define WIDTH 8
// module fake(); in a comment
module top #(parameter W = 8, H = 2, localparam L = 3) (input clk, output [W-1:0] y);
  parameter DEPTH = 16, AW = 4;
  localparam LP = 1;
  wire w;
  sub #(.W(W)) u0 (.a(clk), .y(w));
  sub #8 u1 (clk, w);
  sub u_arr [3:0] (.a(clk));
  sub u2 (.a(clk)), u3 (.a(clk));
  always @(posedge clk) if (w) $display("module nope; nope n(); ");
  assign y = '0;
  my_type_t var1;
endmodule

module automatic sub (input a, output y);
  assign y = a;
endmodule
program prog; endprogram
interface bus_if; logic x; endinterface
`;
    const r = scanSource('d.sv', 'design', src);
    expect(r.modules.map((m) => `${m.kind}:${m.name}`)).toEqual(['module:top', 'module:sub', 'program:prog', 'interface:bus_if']);
    const top = r.modules[0];
    expect(top.instances).toEqual([
      { type: 'sub', name: 'u0' },
      { type: 'sub', name: 'u1' },
      { type: 'sub', name: 'u_arr' },
      { type: 'sub', name: 'u2' },
      { type: 'sub', name: 'u3' },
    ]);
    expect(top.params).toEqual(['W', 'H', 'DEPTH', 'AW']);
    expect(r.hasDumpfile).toBe(false);
  });

  it('records $dumpfile names and file path references', () => {
    const r = scanSource(
      'tb.sv',
      'testbench',
      `\`include "defs.vh"
module tb;
  integer f;
  initial begin
    $dumpfile("waves.vcd"); $dumpvars(0, tb);
    $readmemh("../secret.hex", mem);
    f = $fopen("/etc/passwd", "r");
    $writememh("out.hex", mem);
  end
endmodule`,
    );
    expect(r.hasDumpfile).toBe(true);
    expect(r.dumpfiles).toEqual(['waves.vcd']);
    expect(r.pathRefs.map((p) => `${p.call}:${p.path}:${p.line}`)).toEqual([
      '`include:defs.vh:1',
      '$dumpfile:waves.vcd:5',
      '$readmemh:../secret.hex:6',
      '$fopen:/etc/passwd:7',
      '$writememh:out.hex:8',
    ]);
    expect(unsafePathRefs(r).map((p) => p.path)).toEqual(['../secret.hex', '/etc/passwd']);
  });

  it('notices $dumpfile with a non-literal argument', () => {
    const r = scanSource('tb.sv', 'testbench', 'module tb; string s = "a.vcd"; initial $dumpfile(s); endmodule');
    expect(r.hasDumpfile).toBe(true);
    expect(r.dumpfiles).toEqual([]);
  });

  it('skips macro invocations with arguments', () => {
    const r = scanSource('a.v', 'design', 'module a; `MY_MACRO(x, y) sub u0 (); endmodule module sub; endmodule');
    expect(r.modules[0].instances).toEqual([{ type: 'sub', name: 'u0' }]);
  });
});

describe('findTopCandidates', () => {
  const files = [
    { name: 'design.sv', role: 'design' as const, content: 'module counter(input clk); endmodule\nmodule helper; endmodule\n' },
    { name: 'tb.sv', role: 'testbench' as const, content: 'module tb; counter dut(.clk(1\'b0)); endmodule\n' },
  ];

  it('prefers uninstantiated testbench modules', () => {
    const scan = scanFiles(files);
    expect(findTopCandidates(scan)).toEqual(['tb']);
    expect(findTopCandidates(scan, false)).toEqual(['helper', 'tb']);
  });

  it('falls back to design modules when there is no testbench', () => {
    const scan = scanFiles([files[0]]);
    expect(findTopCandidates(scan)).toEqual(['counter', 'helper']);
  });

  it('ignores interfaces, self-instantiation and empty input', () => {
    const scan = scanFiles([{ name: 'a.sv', content: 'interface bus; endinterface module r; r x(); endmodule' }]);
    expect(findTopCandidates(scan)).toEqual(['r']);
    expect(findTopCandidates(scanFiles([]))).toEqual([]);
  });

  it('moduleParams', () => {
    const scan = scanFiles([{ name: 'a.v', content: 'module a #(parameter int N = 2, parameter [3:0] M = 4\'h1)(); parameter K = 1; endmodule' }]);
    expect(moduleParams(scan, 'a')).toEqual(['N', 'M', 'K']);
    expect(moduleParams(scan, 'zz')).toBeUndefined();
  });
});
