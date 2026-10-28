import { describe, expect, it } from 'vitest';
import {
  PathMapper,
  finalizeDiagnostics,
  parseIverilogOutput,
  parseNextpnrOutput,
  parsePackerOutput,
  parseVvpOutput,
  parseYosysOutput,
  stripAnsi,
} from '../src/flows/diagnostics';

const files = [{ name: 'design.sv' }, { name: 'tb.sv' }, { name: 'rtl/alu.v' }, { name: 'inc/defs.vh' }];
const mapper = new PathMapper(files, 'C:\\Temp\\webeda-jobs\\abc123');

describe('PathMapper', () => {
  it('maps relative, ./, workDir-prefixed and backslash paths', () => {
    expect(mapper.map('design.sv')).toBe('design.sv');
    expect(mapper.map('./design.sv')).toBe('design.sv');
    expect(mapper.map('.\\rtl\\alu.v')).toBe('rtl/alu.v');
    expect(mapper.map('C:\\Temp\\webeda-jobs\\abc123\\rtl\\alu.v')).toBe('rtl/alu.v');
    expect(mapper.map('c:/temp/webeda-jobs/ABC123/tb.sv')).toBe('tb.sv');
    expect(mapper.map('/design.sv')).toBe('design.sv');
    expect(mapper.map('"design.sv"')).toBe('design.sv');
  });

  it('falls back to a unique basename and ignores tool library files', () => {
    expect(mapper.map('somewhere/defs.vh')).toBe('inc/defs.vh');
    expect(mapper.map('/share/ice40/cells_sim.v')).toBeUndefined();
    expect(mapper.map('other.v')).toBeUndefined();
    expect(mapper.map(undefined)).toBeUndefined();
  });
});

describe('parseIverilogOutput', () => {
  it('parses syntax errors, keyword errors, notes and unknown modules', () => {
    const out = `design.sv:3: syntax error
tb.sv:1: error: malformed statement
design.sv:1:      : It was declared here as a variable.
tb.sv:4: warning: Port 2 (q) of counter expects 4 bits, got 3.
tb.sv:1: error: Unknown module type: foo
2 error(s) during elaboration.
*** These modules were missing:
        foo referenced 1 times.
***
I give up.
`;
    const d = parseIverilogOutput(out, mapper, true);
    expect(d).toEqual([
      { severity: 'error', message: 'syntax error', file: 'design.sv', line: 3, tool: 'iverilog' },
      { severity: 'error', message: 'malformed statement', file: 'tb.sv', line: 1, tool: 'iverilog' },
      { severity: 'info', message: 'It was declared here as a variable.', file: 'design.sv', line: 1, tool: 'iverilog' },
      { severity: 'warning', message: 'Port 2 (q) of counter expects 4 bits, got 3.', file: 'tb.sv', line: 4, tool: 'iverilog' },
      { severity: 'error', message: 'Unknown module type: foo', file: 'tb.sv', line: 1, tool: 'iverilog' },
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('I give up') }),
    ]);
  });

  it('handles sorry messages, file-less errors, unknown files and ignored files', () => {
    const out = `design.sv:7: sorry: constant selects in always_* processes are not currently supported.
error: Unable to find the root module "nope" in the Verilog source.
No top level modules, and no -s option.
_webeda_dump.v:4: warning: timescale inherited
C:\\Temp\\webeda-jobs\\abc123\\rtl\\alu.v:9: error: bad
lib/x.v:2: error: elsewhere
`;
    const ok = parseIverilogOutput(out, mapper, false, ['_webeda_dump.v']);
    expect(ok[0]).toMatchObject({ severity: 'warning', file: 'design.sv', line: 7 });
    expect(ok[1]).toEqual({ severity: 'error', tool: 'iverilog', message: 'Unable to find the root module "nope" in the Verilog source.' });
    expect(ok[2].message).toMatch(/No top level modules/);
    expect(ok.some((d) => d.message.includes('timescale'))).toBe(false);
    expect(ok[3]).toMatchObject({ file: 'rtl/alu.v', line: 9, message: 'bad' });
    expect(ok[4]).toEqual({ severity: 'error', tool: 'iverilog', message: 'lib/x.v:2: elsewhere' });
    expect(parseIverilogOutput('design.sv:7: sorry: x', mapper, true)[0].severity).toBe('error');
  });
});

describe('parseVvpOutput', () => {
  it('parses $error/$warning/$fatal/$info and VCD warnings', () => {
    const out = `VCD info: dumpfile dump.vcd opened for output.
ERROR: tb.sv:12: bad  x
       Time: 10  Scope: tb
WARNING: tb.sv:13: w
         Time: 10  Scope: tb
FATAL: tb.sv:14: die
       Time: 10  Scope: tb
INFO: tb.sv:2: hello
ERROR: tb.sv:5:
ERROR: user printed this without a location
VCD warning: $dumpvars: Unsupported argument type (vpiPackage)
q = 4
`;
    expect(parseVvpOutput(out, mapper)).toEqual([
      { severity: 'error', message: 'bad  x', file: 'tb.sv', line: 12, tool: 'vvp' },
      { severity: 'warning', message: 'w', file: 'tb.sv', line: 13, tool: 'vvp' },
      { severity: 'error', message: '致命错误：die', file: 'tb.sv', line: 14, tool: 'vvp' },
      { severity: 'info', message: 'hello', file: 'tb.sv', line: 2, tool: 'vvp' },
      { severity: 'error', message: '$error', file: 'tb.sv', line: 5, tool: 'vvp' },
      { severity: 'warning', message: 'VCD：$dumpvars: Unsupported argument type (vpiPackage)', tool: 'vvp' },
    ]);
  });
});

describe('parseYosysOutput', () => {
  it('strips ANSI colours and extracts file:line from the prefix or the message', () => {
    const out = [
      '\x1b[96mdesign.sv:3: \x1b[0m\x1b[91mERROR:\x1b[0m\x1b[1m\x1b[34m syntax error, unexpected endmodule\x1b[0m',
      "Warning: wire '\\q' is assigned in a block at rtl/alu.v:12.5-12.20.",
      'Warning: Replacing memory \\mem with list of registers.',
      "ERROR: Module `\\missing' referenced in module `\\top' in cell `\\u0' is not part of the design.",
      'design.sv:5.3-5.9: Warning: Identifier `\\x\' is implicitly declared.',
      'Info: not a diagnostic',
    ].join('\n');
    expect(parseYosysOutput(out, mapper)).toEqual([
      { severity: 'error', message: 'syntax error, unexpected endmodule', file: 'design.sv', line: 3, tool: 'yosys' },
      { severity: 'warning', message: "wire '\\q' is assigned in a block at rtl/alu.v:12.5-12.20.", file: 'rtl/alu.v', line: 12, column: 5, tool: 'yosys' },
      { severity: 'warning', message: 'Replacing memory \\mem with list of registers.', tool: 'yosys' },
      { severity: 'error', message: "Module `\\missing' referenced in module `\\top' in cell `\\u0' is not part of the design.", tool: 'yosys' },
      { severity: 'warning', message: "Identifier `\\x' is implicitly declared.", file: 'design.sv', line: 5, column: 3, tool: 'yosys' },
    ]);
  });

  it('does not attribute library file references to user files', () => {
    const d = parseYosysOutput('Warning: something at /share/ice40/cells_sim.v:10.1-20.3', mapper);
    expect(d[0].file).toBeUndefined();
  });

  it('stripAnsi removes CSI sequences', () => {
    expect(stripAnsi('\x1b[1m\x1b[36m2.1. \x1b[0mdone')).toBe('2.1. done');
  });
});

describe('nextpnr / packer output', () => {
  it('parses ERROR and Warning lines', () => {
    const out = `Info: Logic utilisation before packing:
Warning: unmatched constraint 'led_x' (on line 3)
ERROR: IO 'clk' is unconstrained in PCF (override this error with --pcf-allow-unconstrained)
ERROR: Failed to route net for blinky.v:3.
0 warnings, 1 error
`;
    expect(parseNextpnrOutput(out, mapper)).toEqual([
      { severity: 'warning', message: "unmatched constraint 'led_x' (on line 3)", tool: 'nextpnr' },
      { severity: 'error', message: "IO 'clk' is unconstrained in PCF (override this error with --pcf-allow-unconstrained)", tool: 'nextpnr' },
      { severity: 'error', message: 'Failed to route net for blinky.v:3.', tool: 'nextpnr' },
    ]);
  });

  it('parses packer errors', () => {
    expect(parsePackerOutput('icepack', 'Error: failed to open out.asc\n')).toEqual([{ severity: 'error', message: 'failed to open out.asc', tool: 'icepack' }]);
    expect(parsePackerOutput('ecppack', "terminate called after throwing an instance of 'std::runtime_error'\n")[0].severity).toBe('error');
  });
});

describe('finalizeDiagnostics', () => {
  it('dedupes identical diagnostics', () => {
    const d = { severity: 'error' as const, tool: 'yosys', message: 'x' };
    expect(finalizeDiagnostics([d, { ...d }, { ...d, message: 'y' }])).toHaveLength(2);
  });

  it('caps the list but keeps errors', () => {
    const list = [
      ...Array.from({ length: 10 }, (_, i) => ({ severity: 'warning' as const, tool: 't', message: `w${i}` })),
      { severity: 'error' as const, tool: 't', message: 'late error' },
    ];
    const out = finalizeDiagnostics(list, 5);
    expect(out.filter((x) => x.severity === 'warning')).toHaveLength(5);
    expect(out.some((x) => x.message === 'late error')).toBe(true);
    expect(out[out.length - 1]).toMatchObject({ severity: 'info', message: expect.stringContaining('5') });
  });
});
