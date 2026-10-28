import { describe, expect, it } from 'vitest';
import type { ExampleCategory, SourceFile } from '@webeda/shared';
import { BOARDS, generateConstraints, getBoard, getDevice } from '@webeda/shared';
import { EXAMPLES, PLAYGROUND_EXAMPLES, STUDIO_TEMPLATES, getExample } from './index';
import { boardConstraintFile, inferRole, signalBase } from './load';
import { TEMPLATE_DEFS } from './templates';

/* ───────── 简单的 Verilog 头部解析（只用于测试：端口与参数） ───────── */

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function balanced(s: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return { inner: s.slice(open + 1, i), end: i + 1 };
  }
  throw new Error('括号不匹配');
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

interface ModuleHeader {
  params: string[];
  ports: { name: string; dir: string; width: number | null }[];
}

function moduleHeader(files: SourceFile[], name: string): ModuleHeader | null {
  for (const f of files) {
    const s = stripComments(f.content);
    const m = new RegExp(`\\bmodule\\s+${name}\\b`).exec(s);
    if (!m) continue;
    let i = m.index + m[0].length;
    const params: string[] = [];
    while (/\s/.test(s[i])) i++;
    if (s[i] === '#') {
      const open = s.indexOf('(', i);
      const p = balanced(s, open);
      for (const item of splitTop(p.inner)) {
        const pm = /parameter\s+(?:\w+\s+)?(?:\[[^\]]*\]\s*)?(\w+)\s*=/.exec(item);
        if (pm) params.push(pm[1]);
      }
      i = p.end;
    }
    const open = s.indexOf('(', i);
    const body = balanced(s, open).inner;
    const ports: ModuleHeader['ports'] = [];
    let dir = '';
    for (const item of splitTop(body)) {
      const pm = /^\s*(input|output|inout)?\s*(?:wire|logic|reg)?\s*(?:signed\s*)?(?:\[\s*(\d+)\s*:\s*(\d+)\s*\])?\s*(\w+)\s*$/.exec(item);
      if (!pm) throw new Error(`无法解析端口：${item}`);
      if (pm[1]) dir = pm[1];
      const width = pm[2] !== undefined ? Math.abs(Number(pm[2]) - Number(pm[3])) + 1 : null;
      ports.push({ name: pm[4], dir, width });
    }
    return { params, ports };
  }
  return null;
}

/* ───────── 测试 ───────── */

describe('示例清单', () => {
  it('id 唯一且为 kebab-case，counter 排第一', () => {
    const ids = EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(EXAMPLES[0].id).toBe('counter');
    expect(getExample('counter')?.scope).toBe('playground');
    expect(getExample('不存在')).toBeUndefined();
  });

  it('Playground 示例至少 18 个，覆盖 board 以外的全部分类', () => {
    expect(PLAYGROUND_EXAMPLES.length).toBeGreaterThanOrEqual(18);
    const cats: ExampleCategory[] = ['basics', 'combinational', 'sequential', 'fsm', 'memory', 'interface', 'verification'];
    for (const c of cats) expect(PLAYGROUND_EXAMPLES.some((e) => e.category === c), c).toBe(true);
    for (const e of PLAYGROUND_EXAMPLES) {
      expect(e.scope).toBe('playground');
      expect(e.category).not.toBe('board');
      expect(e.simulate?.standard).toBe('2012');
    }
  });

  it('每个示例的文件名合法、角色正确，测试平台写出 VCD 并打印 PASS/FAIL', () => {
    for (const e of EXAMPLES) {
      const names = e.files.map((f) => f.name);
      expect(new Set(names).size, e.id).toBe(names.length);
      for (const f of e.files) {
        expect(f.name).not.toMatch(/\.\.|^\/|\\/);
        expect(f.role, `${e.id}/${f.name}`).toBe(inferRole(f.name));
        expect(f.content.length).toBeGreaterThan(0);
        expect(f.content).not.toContain('\r');
      }
      const tbs = e.files.filter((f) => f.role === 'testbench');
      expect(tbs.length, e.id).toBe(1);
      const tb = tbs[0].content;
      expect(tb).toMatch(/\bmodule\s+tb\b/);
      expect(tb).toContain('$dumpfile("dump.vcd")');
      expect(tb).toContain('$dumpvars(0, tb)');
      expect(tb).toMatch(/PASS/);
      expect(tb).toMatch(/FAIL/);
      expect(e.files.some((f) => f.role === 'design'), e.id).toBe(true);
    }
  });

  it('RAM 示例带有 memory 角色的 .hex 文件且被 $readmemh 引用', () => {
    const ram = getExample('ram-readmemh')!;
    const hex = ram.files.find((f) => f.role === 'memory');
    expect(hex?.name).toBe('ram_init.hex');
    expect(ram.files.find((f) => f.name === 'design.sv')?.content).toContain('$readmemh');
    expect(ram.files.find((f) => f.name === 'testbench.sv')?.content).toContain('"ram_init.hex"');
  });
});

describe('Studio 工程模板', () => {
  it('至少 8 个，分类为 board、作用域为 studio', () => {
    expect(STUDIO_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const t of STUDIO_TEMPLATES) {
      expect(t.category).toBe('board');
      expect(t.scope).toBe('studio');
      expect(t.board).toBe(t.project?.board);
    }
    expect(STUDIO_TEMPLATES.map((t) => t.id)).toContain('virtual-starter');
    expect(getExample('virtual-starter')?.title).toBe('虚拟开发板入门');
  });

  for (const def of TEMPLATE_DEFS) {
    it(`${def.id}：工程设置、端口、约束与板卡一致`, () => {
      const t = getExample(def.id)!;
      const p = t.project!;
      const board = getBoard(p.board)!;
      const dev = getDevice(p.device)!;
      expect(board).toBeDefined();
      expect(dev).toBeDefined();
      expect(board.device).toBe(p.device);
      expect(p.freqMHz).toBe(board.clock.freqMHz);
      expect(p.simTop).toBe('tb');
      expect(p.synth.flatten).toBe(true);

      // 约束文件：存在、扩展名与器件一致、为每个端口位生成了引脚
      const cf = t.files.find((f) => f.name === p.constraintFile)!;
      expect(cf.role).toBe('constraint');
      expect(cf.name.endsWith(dev.constraintExt)).toBe(true);

      // 顶层端口与板卡信号一一对应
      const designs = t.files.filter((f) => f.role === 'design');
      const header = moduleHeader(designs, p.top!)!;
      expect(header, `找不到顶层 ${p.top}`).not.toBeNull();
      expect(header.ports.map((x) => x.name).sort()).toEqual([...def.ports].sort());
      for (const port of header.ports) {
        const pins = board.pins.filter((b) => signalBase(b.signal) === port.name);
        if (port.width === null) {
          expect(pins.map((b) => b.signal), port.name).toEqual([port.name]);
        } else {
          const want = Array.from({ length: port.width }, (_, i) => `${port.name}[${i}]`).sort();
          expect(pins.map((b) => b.signal).sort(), port.name).toEqual(want);
        }
        for (const pin of pins) expect(cf.content, pin.signal).toContain(pin.signal);
        const isInput = pins.every((b) => ['clock', 'button', 'switch', 'uart_rx'].includes(b.peripheral));
        expect(port.dir, port.name).toBe(isInput ? 'input' : 'output');
      }
      expect(header.ports.some((x) => x.name === board.clock.signal)).toBe(true);

      // gatesimParams 必须是顶层参数，且把时钟频率参数改小
      for (const k of Object.keys(p.gatesimParams ?? {})) expect(header.params, k).toContain(k);
      expect(p.gatesimParams?.CLK_HZ).toBe(1000);
      expect(header.params).toContain('CLK_HZ');
    });
  }
});

describe('板卡数据库', () => {
  it('引脚与信号不重复，clock 与 virtual 计数一致', () => {
    const ids = BOARDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BOARDS) {
      expect(getDevice(b.device), b.id).toBeDefined();
      const sigs = b.pins.map((p) => p.signal);
      const pins = b.pins.map((p) => p.pin);
      expect(new Set(sigs).size, b.id).toBe(sigs.length);
      expect(new Set(pins).size, b.id).toBe(pins.length);
      const clk = b.pins.find((p) => p.signal === b.clock.signal)!;
      expect(clk.pin).toBe(b.clock.pin);
      expect(clk.peripheral).toBe('clock');
      const count = (k: string) => b.pins.filter((p) => p.peripheral === k).length;
      expect(b.virtual.leds, b.id).toBe(count('led'));
      expect(b.virtual.switches, b.id).toBe(count('switch'));
      expect(b.virtual.buttons, b.id).toBe(count('button'));
      expect(b.virtual.sevenSegDigits, b.id).toBe(count('digit'));
    }
  });

  it('包含任务要求的全部板卡与关键引脚', () => {
    const pin = (board: string, signal: string) => getBoard(board)?.pins.find((p) => p.signal === signal)?.pin;
    expect(pin('icebreaker', 'clk')).toBe('35');
    expect(['20', '19', '18'].map((x, i) => pin('icebreaker', `btn[${i}]`) === x)).toEqual([true, true, true]);
    expect(pin('icebreaker', 'led[0]')).toBe('26');
    expect(pin('icestick', 'led[4]')).toBe('95');
    expect(pin('icestick', 'tx')).toBe('8');
    expect(pin('ice40-hx8k-breakout', 'clk')).toBe('J3');
    expect(pin('ice40-hx8k-breakout', 'led[7]')).toBe('C3');
    expect(pin('ulx3s', 'clk')).toBe('G2');
    expect(pin('ulx3s', 'rst_n')).toBe('D6');
    expect(pin('ulx3s', 'btn[5]')).toBe('H16');
    expect(pin('ulx3s', 'tx')).toBe('L4');
    expect(pin('basys3', 'clk')).toBe('W5');
    expect(pin('basys3', 'led[15]')).toBe('L1');
    expect(pin('basys3', 'sw[15]')).toBe('R2');
    expect(pin('basys3', 'seg_n[6]')).toBe('U7');
    expect(pin('basys3', 'an_n[3]')).toBe('W4');
    expect(pin('tang-nano-9k', 'clk')).toBe('52');
    expect(pin('tang-nano-9k', 'led_n[5]')).toBe('16');
    expect(getBoard('basys3')?.clock.freqMHz).toBe(100);
    expect(getBoard('tang-nano-9k')?.clock.freqMHz).toBe(27);
  });

  it('generateConstraints 为每个引脚输出一行约束', () => {
    for (const b of BOARDS) {
      const text = generateConstraints(b);
      for (const p of b.pins) expect(text, `${b.id} ${p.signal}`).toContain(p.pin);
    }
  });
});

describe('辅助函数', () => {
  it('inferRole', () => {
    expect(inferRole('design.sv')).toBe('design');
    expect(inferRole('testbench.sv')).toBe('testbench');
    expect(inferRole('tb_blinky.sv')).toBe('testbench');
    expect(inferRole('debounce.sv')).toBe('design');
    expect(inferRole('ram_init.hex')).toBe('memory');
    expect(inferRole('board.pcf')).toBe('constraint');
    expect(inferRole('basys3.xdc')).toBe('constraint');
    expect(inferRole('defs.svh')).toBe('include');
    expect(inferRole('notes.txt')).toBe('other');
  });

  it('boardConstraintFile 只包含用到的端口，并拒绝不存在的端口与错误扩展名', () => {
    const f = boardConstraintFile('icestick', 'x.pcf', ['clk', 'led']);
    expect(f.content).toContain('set_io clk 21');
    expect(f.content).toContain('set_io led[4] 95');
    expect(f.content).not.toContain('tx');
    expect(() => boardConstraintFile('icestick', 'x.pcf', ['sw'])).toThrow();
    expect(() => boardConstraintFile('icestick', 'x.lpf', ['clk'])).toThrow();
    expect(() => boardConstraintFile('nope', 'x.pcf', ['clk'])).toThrow();
  });
});
