import { describe, expect, it } from 'vitest';
import { isSafeRelativePath, parseCompileFlags, parseRunFlags, tokenize } from '../src/flows/flags';
import { checkYosysScript, splitYosysScript } from '../src/flows/yosysScript';

describe('tokenize', () => {
  it('splits on whitespace and honours quotes', () => {
    expect(tokenize(`  -DA=1  -D"B=two words" '-DC=x y' -DD="q\\"x"`).tokens).toEqual(['-DA=1', '-DB=two words', '-DC=x y', '-DD=q"x']);
    expect(tokenize('').tokens).toEqual([]);
    expect(tokenize('""').tokens).toEqual(['']);
    expect(tokenize('"abc').error).toBeDefined();
  });
});

describe('isSafeRelativePath', () => {
  it('accepts paths inside the work dir only', () => {
    expect(isSafeRelativePath('inc')).toBe(true);
    expect(isSafeRelativePath('rtl/sub')).toBe(true);
    for (const bad of ['/etc', 'C:\\x', 'c:/x', '../x', 'a/../../b', 'a\\..\\b', '~', '']) expect(isSafeRelativePath(bad)).toBe(false);
  });
});

describe('parseCompileFlags', () => {
  it('accepts the whitelist', () => {
    const r = parseCompileFlags('-DFOO -DW=8 -D BAR=1 -Ptb.N=4 -Wall -Wno-timescale -g2005-sv -gno-specify -Iinc -I rtl/x -ylib -Y.sv -Y .v -s tb -stop2 -pfileline=1 -Tmax -v');
    expect(r.errors).toEqual([]);
    expect(r.args).toEqual([
      '-DFOO', '-DW=8', '-DBAR=1', '-Ptb.N=4', '-Wall', '-Wno-timescale', '-g2005-sv', '-gno-specify', '-Iinc', '-Irtl/x', '-ylib',
      '-Y.sv', '-Y.v', '-s', 'tb', '-s', 'top2', '-pfileline=1', '-Tmax', '-v',
    ]);
    expect(r.tops).toEqual(['tb', 'top2']);
  });

  it('rejects everything else with a clear message', () => {
    const r = parseCompileFlags('-o out -I../.. -I/etc -m vpi -c cmd.txt -D1BAD -Pnodot=1 -s "a b" -l lib.v');
    expect(r.args).toEqual([]);
    expect(r.errors.length).toBe(13);
    expect(r.errors[0]).toContain('-o');
    expect(r.errors.some((e) => e.includes('../..'))).toBe(true);
  });

  it('handles empty input and missing values', () => {
    expect(parseCompileFlags(undefined)).toEqual({ args: [], errors: [], tops: [] });
    expect(parseCompileFlags('   ').args).toEqual([]);
    expect(parseCompileFlags('-I').errors[0]).toContain('缺少取值');
    expect(parseCompileFlags('-s -DX').errors[0]).toContain('缺少取值');
    expect(parseCompileFlags('x'.repeat(5000)).errors[0]).toContain('过长');
  });
});

describe('parseRunFlags', () => {
  it('only accepts plusargs', () => {
    expect(parseRunFlags('+SEED=1 +verbose "+MSG=hello world"')).toEqual({ args: ['+SEED=1', '+verbose', '+MSG=hello world'], errors: [], tops: [] });
    expect(parseRunFlags('-lxt2 +ok').errors).toHaveLength(1);
    expect(parseRunFlags('').args).toEqual([]);
  });
});

describe('Yosys console script checks', () => {
  it('splits commands, strips comments and keeps quoted text', () => {
    expect(splitYosysScript('read_verilog a.v; synth # comment\n\n  write_json "x;y.json"\n')).toEqual([
      { line: 1, text: 'read_verilog a.v' },
      { line: 1, text: 'synth' },
      { line: 3, text: 'write_json "x;y.json"' },
    ]);
  });

  it('accepts normal scripts', () => {
    expect(checkYosysScript('read_verilog -sv design.sv\nsynth_ice40 -top top\ntee -o out/stat.txt stat\nwrite_json net.json\nread_verilog -lib +/ice40/cells_sim.v')).toEqual([]);
  });

  it('rejects shell escapes, dangerous commands and paths outside the work dir', () => {
    const p = checkYosysScript(['!ls', 'shell rm -rf x', 'tcl evil.tcl', 'plugin -i x.so', 'write_json /tmp/x.json', 'tee -o ../x.txt stat', 'write_verilog C:\\x.v', 'log -o/etc/x hi'].join('\n'));
    expect(p.map((x) => x.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
