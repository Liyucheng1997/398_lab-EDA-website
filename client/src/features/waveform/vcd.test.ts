import { describe, expect, it } from 'vitest';
import { BIT_0, BIT_1, BIT_X, BIT_Z, extendBits, parseTimescale, parseVcd, type VcdData } from './vcd';

const IVERILOG = `$date
	Wed Oct 28 16:29:27 2026
$end
$version
	Icarus Verilog
$end
$timescale
	1ns
$end
$scope module tb $end
$var wire 8 ! q [7:0] $end
$var wire 4 " cnt [3:0] $end
$var reg 1 # clk $end
$var reg 8 $ d [7:0] $end
$scope module u $end
$var event 1 % ev $end
$var wire 1 # clk $end
$var wire 8 & d [7:0] $end
$var reg 4 ' cnt [3:0] $end
$var reg 8 ( q [7:0] $end
$var real 1 ) r $end
$upscope $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
r0 )
bx (
bz '
b0 &
1%
b0 $
0#
bz "
bx !
$end
#5
bx "
b0 !
1%
r0.5 )
1#
#10
0#
#12
b10100101 $
#32
bx0011 $
#52
$dumpoff
rNaN )
bx $
x#
$end
#72
$dumpon
b1 $
0#
$end
#82
`;

function varByPath(d: VcdData, path: string) {
  const v = d.vars.find((x) => x.path === path);
  if (!v) throw new Error(`no var ${path}`);
  return v;
}

describe('parseTimescale', () => {
  it('parses all units and magnitudes', () => {
    expect(parseTimescale('1ns')).toEqual({ magnitude: 1, unit: 'ns' });
    expect(parseTimescale(' 10 ps ')).toEqual({ magnitude: 10, unit: 'ps' });
    expect(parseTimescale('100fs')).toEqual({ magnitude: 100, unit: 'fs' });
    expect(parseTimescale('1 s')).toEqual({ magnitude: 1, unit: 's' });
    expect(parseTimescale('1 ms')).toEqual({ magnitude: 1, unit: 'ms' });
    expect(parseTimescale('1us')).toEqual({ magnitude: 1, unit: 'us' });
    expect(parseTimescale('1 µs')).toEqual({ magnitude: 1, unit: 'us' });
    expect(parseTimescale('3 ns')).toBeNull();
    expect(parseTimescale('1 xs')).toBeNull();
  });
});

describe('extendBits', () => {
  it('extends per VCD rules', () => {
    expect(extendBits('1', 4)).toBe('0001');
    expect(extendBits('0', 4)).toBe('0000');
    expect(extendBits('x', 4)).toBe('xxxx');
    expect(extendBits('z1', 4)).toBe('zzz1');
    expect(extendBits('x0011', 8)).toBe('xxxx0011');
    expect(extendBits('10', 2)).toBe('10');
    expect(extendBits('X1Z', 3)).toBe('x1z');
    expect(extendBits('110101', 4)).toBe('0101');
    expect(extendBits('', 3)).toBe('xxx');
    expect(extendBits('UHL-', 4)).toBe('x10x');
  });
});

describe('parseVcd (iverilog output)', () => {
  const d = parseVcd(IVERILOG);

  it('reads header', () => {
    expect(d.timescale).toEqual({ magnitude: 1, unit: 'ns' });
    expect(d.version).toBe('Icarus Verilog');
    expect(d.date).toContain('2026');
    expect(d.truncated).toBe(false);
    expect(d.warnings).toEqual([]);
  });

  it('builds scope hierarchy', () => {
    expect(d.root.scopes.map((s) => s.name)).toEqual(['tb']);
    const tb = d.root.scopes[0];
    expect(tb.type).toBe('module');
    expect(tb.path).toBe('tb');
    expect(tb.scopes[0].path).toBe('tb.u');
    expect(tb.vars.map((i) => d.vars[i].name)).toEqual(['q', 'cnt', 'clk', 'd']);
    expect(tb.scopes[0].vars).toHaveLength(6);
  });

  it('parses var declarations with ranges', () => {
    const q = varByPath(d, 'tb.q');
    expect(q.range).toBe('[7:0]');
    expect(q.width).toBe(8);
    expect(q.msb).toBe(7);
    expect(q.lsb).toBe(0);
    expect(q.type).toBe('wire');
    expect(d.waves[varByPath(d, 'tb.u.r').wave].kind).toBe('real');
    expect(d.waves[varByPath(d, 'tb.u.ev').wave].kind).toBe('event');
  });

  it('shares waves between aliases', () => {
    expect(varByPath(d, 'tb.clk').wave).toBe(varByPath(d, 'tb.u.clk').wave);
  });

  it('records scalar transitions with dedupe', () => {
    const w = d.waves[varByPath(d, 'tb.clk').wave];
    expect(Array.from(w.times)).toEqual([0, 5, 10, 52, 72]);
    expect(Array.from(w.bits!)).toEqual([BIT_0, BIT_1, BIT_0, BIT_X, BIT_0]);
  });

  it('records vector transitions left-extended', () => {
    const w = d.waves[varByPath(d, 'tb.d').wave];
    expect(Array.from(w.times)).toEqual([0, 12, 32, 52, 72]);
    expect(w.vecs).toEqual(['00000000', '10100101', 'xxxx0011', 'xxxxxxxx', '00000001']);
    const cnt = d.waves[varByPath(d, 'tb.cnt').wave];
    expect(cnt.vecs).toEqual(['zzzz', 'xxxx']);
  });

  it('records reals including NaN', () => {
    const w = d.waves[varByPath(d, 'tb.u.r').wave];
    expect(Array.from(w.times)).toEqual([0, 5, 52]);
    expect(w.reals![0]).toBe(0);
    expect(w.reals![1]).toBe(0.5);
    expect(Number.isNaN(w.reals![2])).toBe(true);
  });

  it('records each event trigger', () => {
    const w = d.waves[varByPath(d, 'tb.u.ev').wave];
    expect(Array.from(w.times)).toEqual([0, 5]);
  });

  it('tracks time range', () => {
    expect(d.startTime).toBe(0);
    expect(d.endTime).toBe(82);
    expect(d.changeCount).toBeGreaterThan(10);
  });
});

describe('parseVcd edge cases', () => {
  it('handles empty input', () => {
    const d = parseVcd('');
    expect(d.vars).toHaveLength(0);
    expect(d.truncated).toBe(true);
    expect(d.endTime).toBe(0);
  });

  it('handles truncated body (partial last token)', () => {
    const text = [
      '$timescale 1ps $end',
      '$scope module top $end',
      '$var wire 4 a bus $end',
      '$var wire 1 b clk $end',
      '$upscope $end',
      '$enddefinitions $end',
      '#0',
      'b0000 a',
      '0b',
      '#10',
      '1b',
      'b1010 a',
      '#20',
      'b11',
    ].join('\n');
    const d = parseVcd(text);
    expect(d.truncated).toBe(true);
    expect(d.timescale).toEqual({ magnitude: 1, unit: 'ps' });
    const a = d.waves[d.vars[0].wave];
    expect(a.vecs).toEqual(['0000', '1010']);
    expect(d.endTime).toBe(20);
  });

  it('accepts a final time stamp without trailing newline', () => {
    const d = parseVcd('$timescale 1ns $end $scope module t $end $var wire 1 ! a $end $upscope $end $enddefinitions $end #0 1! #40');
    expect(d.truncated).toBe(false);
    expect(d.endTime).toBe(40);
  });

  it('handles truncated header', () => {
    const d = parseVcd('$timescale 1ns $end\n$scope module top $end\n$var wire 1 ! a $end\n$var wi');
    expect(d.truncated).toBe(true);
    expect(d.vars).toHaveLength(1);
    expect(d.vars[0].path).toBe('top.a');
  });

  it('accepts uppercase states, x/z scalars and $dumpall', () => {
    const d = parseVcd(
      [
        '$timescale 10 us $end',
        '$scope module m $end $var reg 1 ! a $end $var reg 3 " b [2:0] $end $upscope $end',
        '$enddefinitions $end',
        '#0 $dumpvars X! bZ " $end',
        '#1 Z! b1X "',
        '#2 $dumpall 1! b101 " $end',
        '',
      ].join('\n'),
    );
    expect(d.timescale).toEqual({ magnitude: 10, unit: 'us' });
    const a = d.waves[d.vars[0].wave];
    expect(Array.from(a.bits!)).toEqual([BIT_X, BIT_Z, BIT_1]);
    const b = d.waves[d.vars[1].wave];
    expect(b.vecs).toEqual(['zzz', '01x', '101']);
  });

  it('nests task/function/begin/fork scopes and bit-select names', () => {
    const d = parseVcd(
      [
        '$timescale 1ns $end',
        '$scope module top $end',
        '$scope begin blk $end',
        '$var logic 1 ! data [0] $end',
        '$var logic 1 " data [1] $end',
        '$upscope $end',
        '$scope task t $end $var integer 32 # i $end $upscope $end',
        '$scope function f $end $var bit 1 $ r $end $upscope $end',
        '$scope fork fk $end $var parameter 8 % P $end $upscope $end',
        '$upscope $end',
        '$var supply1 1 & vdd $end',
        '$enddefinitions $end',
        '#0',
        '1!',
        '0"',
        'b101 #',
        '0$',
        'b11111111 %',
        '1&',
        '',
      ].join('\n'),
    );
    const top = d.root.scopes[0];
    expect(top.scopes.map((s) => `${s.type}:${s.name}`)).toEqual(['begin:blk', 'task:t', 'function:f', 'fork:fk']);
    expect(d.vars.map((v) => v.path)).toEqual(['top.blk.data[0]', 'top.blk.data[1]', 'top.t.i', 'top.f.r', 'top.fk.P', 'vdd']);
    expect(d.root.vars).toHaveLength(1);
    expect(d.waves[d.vars[2].wave].vecs).toEqual(['00000000000000000000000000000101']);
    expect(d.vars[0].msb).toBe(0);
  });

  it('handles ref with attached range and duplicate names', () => {
    const d = parseVcd(
      [
        '$timescale 1ns $end',
        '$scope module top $end',
        '$var wire 8 ! mem[7:0] $end',
        '$var wire 8 " mem [15:8] $end',
        '$upscope $end',
        '$enddefinitions $end',
        '#0',
        'b1 !',
        '',
      ].join('\n'),
    );
    expect(d.vars[0].name).toBe('mem');
    expect(d.vars[0].range).toBe('[7:0]');
    expect(d.vars[0].path).toBe('top.mem');
    expect(d.vars[1].path).toBe('top.mem[15:8]');
  });

  it('overwrites multiple assignments at the same time and ignores time going backwards', () => {
    const d = parseVcd(
      [
        '$timescale 1ns $end',
        '$scope module top $end $var wire 1 ! a $end $upscope $end',
        '$enddefinitions $end',
        '#0 0!',
        '#5 1! 0!',
        '#7 1!',
        '#3 0!',
        '#9 0!',
        '',
      ].join('\n'),
    );
    const w = d.waves[0];
    expect(Array.from(w.times)).toEqual([0, 7, 9]);
    expect(Array.from(w.bits!)).toEqual([0, 1, 0]);
    expect(d.warnings.some((m) => m.includes('回退'))).toBe(true);
  });

  it('warns on unknown codes and skips comments', () => {
    const d = parseVcd(
      [
        '$comment hello $end',
        '$timescale 1ns $end',
        '$scope module top $end $var wire 1 ! a $end $upscope $end',
        '$enddefinitions $end',
        '#0 1! 1?',
        '$comment inline 1! $end',
        '#4 0!',
        '',
      ].join('\n'),
    );
    expect(Array.from(d.waves[0].times)).toEqual([0, 4]);
    expect(d.warnings.some((m) => m.includes('?'))).toBe(true);
  });

  it('defaults timescale when missing', () => {
    const d = parseVcd('$scope module top $end $var wire 1 ! a $end $upscope $end $enddefinitions $end #0 1!\n');
    expect(d.timescale).toEqual({ magnitude: 1, unit: 'ns' });
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it('parses real and string values on mixed kinds', () => {
    const d = parseVcd(
      [
        '$timescale 1ns $end',
        '$scope module top $end',
        '$var real 64 ! v $end',
        '$var string 1 " s $end',
        '$upscope $end',
        '$enddefinitions $end',
        '#0 r1.5e-3 ! shello "',
        '#1 r-inf ! sworld "',
        '',
      ].join('\n'),
    );
    expect(Array.from(d.waves[0].reals!)).toEqual([0.0015, -Infinity]);
    expect(d.waves[1].kind).toBe('string');
    expect(d.waves[1].vecs).toEqual(['hello', 'world']);
  });

  it('parses large inputs quickly and reports progress', () => {
    const lines: string[] = ['$timescale 1ps $end', '$scope module top $end'];
    for (let s = 0; s < 20; s++) lines.push(`$var wire 16 s${s} bus${s} [15:0] $end`, `$var wire 1 c${s} clk${s} $end`);
    lines.push('$upscope $end', '$enddefinitions $end');
    for (let t = 0; t < 20000; t++) {
      lines.push(`#${t * 10}`);
      for (let s = 0; s < 20; s++) lines.push(`b${((t * (s + 1)) & 0xffff).toString(2)} s${s}`, `${t & 1}c${s}`);
    }
    const text = `${lines.join('\n')}\n`;
    expect(text.length).toBeGreaterThan(3_000_000);
    const prog: number[] = [];
    const t0 = performance.now();
    const d = parseVcd(text, (f) => prog.push(f));
    const ms = performance.now() - t0;
    expect(d.vars).toHaveLength(40);
    expect(d.waves[1].times.length).toBe(20000);
    expect(prog.length).toBeGreaterThan(1);
    expect(prog[prog.length - 1]).toBe(1);
    expect(ms).toBeLessThan(5000);
  });
});
