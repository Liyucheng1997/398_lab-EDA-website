import { describe, expect, it } from 'vitest';
import type { SourceFile } from '@webeda/shared';
import {
  consoleScript,
  constraintFiles,
  fileOfModule,
  filesForKind,
  groupFiles,
  inferRole,
  inputHash,
  moduleInfo,
  parseModules,
  stripComments,
  stripAnsi,
  validateFileName,
} from './model';
import { defaultSettings } from './scaffold';
import { getDevice } from '@webeda/shared';

const files: SourceFile[] = [
  { name: 'top.sv', content: 'module top(input clk); alu #(.W(8)) u_alu (.a(1)); counter c0(.clk(clk)); endmodule' },
  { name: 'alu.sv', content: '// module fake;\nmodule alu #(parameter W=4)(input a); endmodule' },
  { name: 'counter.v', content: '/* module ghost */ module counter(input clk); endmodule\nmodule unused_helper; endmodule' },
  { name: 'tb_top.sv', content: 'module tb_top; top dut(.clk(1\'b0)); endmodule' },
  { name: 'icebreaker.pcf', content: 'set_io clk 35' },
  { name: 'pins.lpf', content: '' },
  { name: 'defs.svh', content: '`define X 1' },
  { name: 'rom.hex', content: '00\n01' },
  { name: 'README.md', content: '# hi' },
];

describe('inferRole / groupFiles', () => {
  it('infers roles like the server', () => {
    expect(inferRole('top.sv')).toBe('design');
    expect(inferRole('rtl/alu.v')).toBe('design');
    expect(inferRole('tb_top.sv')).toBe('testbench');
    expect(inferRole('top_tb.sv')).toBe('testbench');
    expect(inferRole('my_testbench.v')).toBe('testbench');
    expect(inferRole('board.PCF')).toBe('constraint');
    expect(inferRole('x.xdc')).toBe('constraint');
    expect(inferRole('defs.svh')).toBe('include');
    expect(inferRole('rom.mem')).toBe('memory');
    expect(inferRole('notes.txt')).toBe('other');
  });

  it('groups files in fixed order, include with design, explicit role wins', () => {
    const groups = groupFiles([...files, { name: 'odd.sv', content: '', role: 'testbench' }]);
    expect(groups.map((g) => g.key)).toEqual(['design', 'constraint', 'testbench', 'memory', 'other']);
    expect(groups[0].files.map((f) => f.name)).toEqual(['alu.sv', 'counter.v', 'defs.svh', 'top.sv']);
    expect(groups[1].files.map((f) => f.name)).toEqual(['icebreaker.pcf', 'pins.lpf']);
    expect(groups[2].files.map((f) => f.name)).toEqual(['odd.sv', 'tb_top.sv']);
    expect(groups[3].files.map((f) => f.name)).toEqual(['rom.hex']);
    expect(groups[4].files.map((f) => f.name)).toEqual(['README.md']);
  });

  it('returns all groups even for an empty project', () => {
    expect(groupFiles([]).every((g) => g.files.length === 0)).toBe(true);
  });
});

describe('validateFileName', () => {
  it('accepts normal names and sub dirs', () => {
    expect(validateFileName('rtl/alu.sv', [])).toBeNull();
    expect(validateFileName('a b.v', [])).toBeNull();
  });
  it('rejects bad names', () => {
    expect(validateFileName('', [])).toBeTruthy();
    expect(validateFileName('../x.v', [])).toBeTruthy();
    expect(validateFileName('/x.v', [])).toBeTruthy();
    expect(validateFileName('C:/x.v', [])).toBeTruthy();
    expect(validateFileName('a//b.v', [])).toBeTruthy();
    expect(validateFileName('中文.v', [])).toBeTruthy();
    expect(validateFileName('Top.sv', ['top.sv'])).toBe('已存在同名文件');
    expect(validateFileName('top.sv', ['top.sv'], 'top.sv')).toBeNull();
  });
});

describe('module parsing', () => {
  it('ignores comments and strings', () => {
    expect(stripComments('a // x\nb /* y\nz */ c "module q"')).toBe('a \nb \n c ""');
    expect(parseModules(files[1].content)).toEqual(['alu']);
    expect(parseModules(files[2].content)).toEqual(['counter', 'unused_helper']);
  });

  it('finds top candidates', () => {
    const d = moduleInfo(files, ['design']);
    expect(d.all).toEqual(['top', 'alu', 'counter', 'unused_helper']);
    expect(d.tops).toEqual(['top', 'unused_helper']);
    const t = moduleInfo(files, ['testbench']);
    expect(t.tops).toEqual(['tb_top']);
    expect(fileOfModule(files, 'counter')).toBe('counter.v');
    expect(fileOfModule(files, 'nope')).toBeUndefined();
  });
});

describe('job inputs', () => {
  it('selects files per kind with explicit roles', () => {
    const synth = filesForKind(files, 'synthesize').map((f) => f.name);
    expect(synth).toEqual(['top.sv', 'alu.sv', 'counter.v', 'defs.svh', 'rom.hex']);
    const impl = filesForKind(files, 'implement', 'icebreaker.pcf');
    expect(impl.map((f) => f.name)).toContain('icebreaker.pcf');
    expect(impl.map((f) => f.name)).not.toContain('pins.lpf');
    expect(impl.every((f) => f.role)).toBe(true);
    const sim = filesForKind(files, 'simulate').map((f) => f.name);
    expect(sim).toContain('tb_top.sv');
    expect(sim).not.toContain('icebreaker.pcf');
    expect(sim).not.toContain('README.md');
  });

  it('builds console scripts', () => {
    expect(consoleScript(files, 'top', 'stat', false)).toBe('read_verilog -sv top.sv alu.sv counter.v\nhierarchy -check -top top\nstat');
    expect(consoleScript(files, undefined, 'stat', false)).toContain('hierarchy -auto-top');
    expect(consoleScript(files, 'top', 'help', true)).toBe('help');
  });

  it('input hash changes only with relevant inputs', () => {
    const settings = { ...defaultSettings(getDevice('ice40-up5k-sg48')!), constraintFile: 'icebreaker.pcf' };
    const p = { files, settings };
    const h = inputHash('synthesize', p);
    expect(inputHash('synthesize', { files, settings: { ...settings, freqMHz: 50 } })).toBe(h);
    expect(inputHash('implement', { files, settings: { ...settings, freqMHz: 50 } })).not.toBe(inputHash('implement', p));
    const edited = files.map((f) => (f.name === 'alu.sv' ? { ...f, content: f.content + ' ' } : f));
    expect(inputHash('synthesize', { files: edited, settings })).not.toBe(h);
    const tbEdited = files.map((f) => (f.name === 'tb_top.sv' ? { ...f, content: f.content + ' ' } : f));
    expect(inputHash('synthesize', { files: tbEdited, settings })).toBe(h);
    expect(inputHash('simulate', { files: tbEdited, settings })).not.toBe(inputHash('simulate', p));
  });

  it('lists constraint files with device extension first', () => {
    expect(constraintFiles(files, 'ecp5-25k-cabga256')).toEqual(['pins.lpf', 'icebreaker.pcf']);
    expect(constraintFiles(files, 'ice40-up5k-sg48')).toEqual(['icebreaker.pcf', 'pins.lpf']);
  });
});

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\u001b[1m\u001b[36m2.1. \u001b[0mDone')).toBe('2.1. Done');
    expect(stripAnsi('\u001b[90m-- x --\n\u001b[0m')).toBe('-- x --\n');
    expect(stripAnsi('plain')).toBe('plain');
  });
});
