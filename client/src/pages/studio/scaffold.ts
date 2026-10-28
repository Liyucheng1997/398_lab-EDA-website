/**
 * 新建工程脚手架：按板卡引脚生成 top.sv / 约束 / 测试平台，以及默认工程设置。
 */
import type { BoardInfo, BoardPin, DeviceInfo, Example, ProjectInput, ProjectSettings, SourceFile } from '@webeda/shared';
import { generateConstraints, getBoard, getDevice } from '@webeda/shared';
import { inferRole, moduleInfo, roleOf } from './model';

export interface PortSpec {
  name: string;
  dir: 'input' | 'output' | 'inout';
  /** 位宽（1 = 标量） */
  width: number;
  peripheral: BoardPin['peripheral'];
  comment?: string;
}

function dirOf(p: BoardPin['peripheral']): PortSpec['dir'] {
  switch (p) {
    case 'clock':
    case 'switch':
    case 'button':
    case 'uart_rx':
      return 'input';
    case 'led':
    case 'rgb':
    case 'seg':
    case 'digit':
    case 'uart_tx':
      return 'output';
    default:
      return 'inout';
  }
}

const IDENT = /^[A-Za-z_][\w$]*$/;

/** 板卡引脚 → 顶层端口（led[0..7] 合并为 led[7:0]），保持首次出现顺序，时钟排第一 */
export function boardPorts(board: BoardInfo): PortSpec[] {
  const map = new Map<string, PortSpec>();
  const labels = new Map<string, Map<number, string>>();
  for (const pin of board.pins) {
    const m = /^([A-Za-z_][\w$]*)(?:\[(\d+)\])?$/.exec(pin.signal.trim());
    if (!m) continue;
    const [, base, idx] = m;
    const bit = idx != null ? Number(idx) : -1;
    const width = bit + 1 || 1;
    if (pin.label) {
      if (!labels.has(base)) labels.set(base, new Map());
      labels.get(base)!.set(bit, pin.label);
    }
    const existing = map.get(base);
    if (existing) {
      existing.width = Math.max(existing.width, width);
    } else {
      map.set(base, { name: base, dir: dirOf(pin.peripheral), width, peripheral: pin.peripheral, comment: pin.label });
    }
  }
  // 多位端口的注释：首位与末位标签，如 "LD0 … LD15"
  for (const p of map.values()) {
    if (p.width <= 1) continue;
    const l = labels.get(p.name);
    const first = l?.get(0);
    const last = l?.get(p.width - 1);
    p.comment = first && last ? `${first} … ${last}` : first ?? last ?? `${p.width} 位`;
  }
  const clk = board.clock.signal.replace(/\[\d+\]$/, '');
  if (IDENT.test(clk)) {
    const c = map.get(clk);
    if (c) {
      c.dir = 'input';
      c.peripheral = 'clock';
      c.comment = c.comment ?? `${board.clock.freqMHz} MHz`;
    } else {
      map.set(clk, { name: clk, dir: 'input', width: 1, peripheral: 'clock', comment: `${board.clock.freqMHz} MHz` });
    }
  }
  const list = [...map.values()];
  return [...list.filter((p) => p.name === clk), ...list.filter((p) => p.name !== clk)];
}

/** 没有板卡时的通用端口 */
export function barePorts(): PortSpec[] {
  return [
    { name: 'clk', dir: 'input', width: 1, peripheral: 'clock', comment: '时钟' },
    { name: 'rst_n', dir: 'input', width: 1, peripheral: 'button', comment: '低有效复位' },
    { name: 'led', dir: 'output', width: 4, peripheral: 'led', comment: 'LED' },
  ];
}

const isActiveLow = (name: string) => /_n$|_b$/i.test(name);
const isResetName = (name: string) => /^(rst|reset|rst_n|resetn|reset_n|rstn)$/i.test(name);

/** 让 LED 以约 1 Hz 闪烁所需的计数器位宽 */
export function counterWidth(freqMHz: number, ledBits: number): number {
  const hz = Math.max(1, freqMHz) * 1e6;
  return Math.max(Math.ceil(Math.log2(hz)), ledBits + 2, 8);
}

function decl(p: PortSpec, dirPad: number) {
  const type = p.dir === 'inout' ? 'wire ' : 'logic';
  const range = p.width > 1 ? `[${p.width - 1}:0]` : '';
  return `${p.dir.padEnd(dirPad)} ${type} ${range.padEnd(6)} ${p.name}`;
}

/** 生成顶层模块骨架：端口与板卡引脚一致，带一个让 LED 闪烁的计数器 */
export function generateTopModule(opts: { ports: PortSpec[]; freqMHz: number; title: string; topName?: string }): string {
  const { ports, freqMHz, title } = opts;
  const top = opts.topName ?? 'top';
  const clk = ports.find((p) => p.peripheral === 'clock' && p.dir === 'input');
  const leds = ports.filter((p) => p.dir === 'output' && p.peripheral === 'led');
  const ledBits = leds.reduce((n, p) => n + p.width, 0);
  const cntW = counterWidth(freqMHz, Math.max(...leds.map((p) => p.width), 1));
  const reset = ports.find((p) => p.dir === 'input' && isResetName(p.name));

  const lines: string[] = [];
  lines.push(`// ${top}.sv — ${title}`);
  lines.push('// 由 WebEDA 生成的顶层骨架：端口与约束文件中的引脚一一对应。');
  lines.push('');
  lines.push(`module ${top} #(`);
  lines.push(`  parameter integer CNT_W = ${cntW}  // 计数器位宽：决定 LED 闪烁速度（仿真/虚拟板会改小）`);
  lines.push(') (');
  const width = Math.max(...ports.map((p) => decl(p, 6).length), 0);
  ports.forEach((p, i) => {
    const sep = i === ports.length - 1 ? '' : ',';
    const d = decl(p, 6) + sep;
    lines.push(`  ${p.comment ? `${d.padEnd(width + 1)}  // ${p.comment}` : d}`);
  });
  lines.push(');');
  lines.push('');
  if (clk) {
    lines.push('  logic [CNT_W-1:0] blink_cnt = \'0;');
    lines.push('');
    lines.push(`  always_ff @(posedge ${clk.name}) begin`);
    if (reset) {
      const low = /n$/i.test(reset.name);
      lines.push(`    if (${low ? '!' : ''}${reset.name}) blink_cnt <= '0;`);
      lines.push("    else blink_cnt <= blink_cnt + 1'b1;");
    } else {
      lines.push("    blink_cnt <= blink_cnt + 1'b1;");
    }
    lines.push('  end');
    lines.push('');
  }
  let bit = 0;
  for (const p of ports) {
    if (p.dir !== 'output') continue;
    if (p.peripheral === 'led' && clk) {
      if (p.width === 1) {
        lines.push(`  assign ${p.name} = blink_cnt[CNT_W-${1 + (bit % 4)}];`);
        bit++;
      } else {
        lines.push(`  assign ${p.name} = blink_cnt[CNT_W-1 -: ${p.width}];`);
        bit += p.width;
      }
    } else if (p.peripheral === 'uart_tx') {
      lines.push(`  assign ${p.name} = 1'b1;  // UART 空闲为高电平`);
    } else {
      const off = isActiveLow(p.name) ? "'1" : "'0";
      lines.push(`  assign ${p.name} = ${p.width > 1 ? off : off === "'1" ? "1'b1" : "1'b0"};`);
    }
  }
  if (ledBits === 0) lines.push('  // 在这里编写你的设计');
  const inouts = ports.filter((p) => p.dir === 'inout');
  if (inouts.length) lines.push(`  // 双向端口 ${inouts.map((p) => p.name).join(', ')} 未驱动（高阻）`);
  lines.push('');
  lines.push('endmodule');
  return lines.join('\n') + '\n';
}

/** 生成测试平台：时钟、输入的默认电平、复位序列、波形转储 */
export function generateTestbench(opts: { ports: PortSpec[]; freqMHz: number; topName?: string; tbName?: string; cycles?: number }): string {
  const { ports, freqMHz } = opts;
  const top = opts.topName ?? 'top';
  const tb = opts.tbName ?? 'tb_top';
  const cycles = opts.cycles ?? 400;
  const halfNs = Number((1000 / Math.max(0.001, freqMHz) / 2).toFixed(3));
  const leds = ports.filter((p) => p.dir === 'output' && p.peripheral === 'led');
  const cntW = Math.max(6, ...leds.map((p) => p.width + 2));
  const clk = ports.find((p) => p.peripheral === 'clock' && p.dir === 'input');
  const range = (p: PortSpec) => (p.width > 1 ? `[${p.width - 1}:0] ` : '');

  const lines: string[] = [];
  lines.push('`timescale 1ns/1ps');
  lines.push(`// ${tb}.sv — ${top} 的测试平台`);
  lines.push('');
  lines.push(`module ${tb};`);
  const resets: PortSpec[] = [];
  for (const p of ports) {
    if (p.dir === 'input') {
      let init: string;
      if (p === clk) init = "1'b0";
      else if (isResetName(p.name)) {
        resets.push(p);
        init = /n$/i.test(p.name) ? "1'b0" : "1'b1";
      } else if (p.peripheral === 'uart_rx') init = p.width > 1 ? "'1" : "1'b1";
      else if (isActiveLow(p.name)) init = p.width > 1 ? "'1" : "1'b1";
      else init = p.width > 1 ? "'0" : "1'b0";
      lines.push(`  logic ${range(p)}${p.name} = ${init};`);
    } else {
      lines.push(`  wire  ${range(p)}${p.name};`);
    }
  }
  lines.push('');
  const conns = ports.map((p) => `.${p.name}(${p.name})`);
  lines.push(`  ${top} #(.CNT_W(${cntW})) dut (`);
  conns.forEach((c, i) => lines.push(`    ${c}${i === conns.length - 1 ? '' : ','}`));
  lines.push('  );');
  lines.push('');
  if (clk) {
    lines.push(`  // ${freqMHz} MHz 时钟`);
    lines.push(`  always #${halfNs} ${clk.name} = ~${clk.name};`);
    lines.push('');
  }
  lines.push('  initial begin');
  lines.push('    $dumpfile("dump.vcd");');
  lines.push(`    $dumpvars(0, ${tb});`);
  if (clk) {
    if (resets.length) {
      lines.push(`    repeat (4) @(posedge ${clk.name});`);
      for (const r of resets) lines.push(`    ${r.name} = ${/n$/i.test(r.name) ? "1'b1" : "1'b0"};  // 释放复位`);
    }
    lines.push(`    repeat (${cycles}) @(posedge ${clk.name});`);
  } else {
    lines.push('    #1000;');
  }
  lines.push('    $display("simulation finished at %0t", $time);');
  lines.push('    $finish;');
  lines.push('  end');
  lines.push('');
  lines.push('endmodule');
  return lines.join('\n') + '\n';
}

/** 没有板卡时的约束模板（全部为注释，告诉用户语法） */
export function constraintTemplate(device: DeviceInfo): string {
  const head = `# ${device.name} (${device.partNumber}) 约束文件 — 由 WebEDA 生成\n# 取消注释并改成实际引脚：\n`;
  switch (device.constraintExt) {
    case '.pcf':
      return `${head}# set_io clk 35\n# set_io led[0] 11\n`;
    case '.lpf':
      return `${head}# LOCATE COMP "clk" SITE "P3";\n# IOBUF PORT "clk" IO_TYPE=LVCMOS33;\n# FREQUENCY PORT "clk" 25 MHZ;\n`;
    case '.xdc':
      return `${head}# set_property -dict { PACKAGE_PIN E3 IOSTANDARD LVCMOS33 } [get_ports clk];\n# create_clock -period 10.000 -name sys_clk [get_ports clk];\n`;
    default:
      return `${head}# IO_LOC "clk" 52;\n# IO_PORT "clk" IO_TYPE=LVCMOS33;\n`;
  }
}

/** 器件族的典型板载时钟频率（无板卡时作为默认约束频率） */
export function defaultFreq(device: DeviceInfo): number {
  switch (device.family) {
    case 'ice40':
      return 12;
    case 'ecp5':
      return 25;
    case 'xc7':
      return 100;
    default:
      return 27;
  }
}

/** 默认工程设置 */
export function defaultSettings(device: DeviceInfo, board?: BoardInfo): ProjectSettings {
  return {
    device: device.id,
    board: board?.id,
    top: 'top',
    simTop: 'tb_top',
    freqMHz: board?.clock.freqMHz ?? defaultFreq(device),
    synth: { flatten: true },
    simulate: { standard: '2012' },
  };
}

/** 空工程：top.sv + 约束 + tb_top.sv */
export function buildEmptyProject(input: { name: string; description?: string; device: DeviceInfo; board?: BoardInfo }): ProjectInput {
  const { device, board } = input;
  const settings = defaultSettings(device, board);
  const ports = board ? boardPorts(board) : barePorts();
  const title = board ? `${board.name} (${device.partNumber})` : device.partNumber;
  const constraintName = `${board ? board.id.replace(/[^\w\-.]/g, '_') : 'top'}${device.constraintExt}`;
  const constraint = board ? generateConstraints(board) : constraintTemplate(device);
  const leds = ports.filter((p) => p.dir === 'output' && p.peripheral === 'led');
  const files: SourceFile[] = [
    { name: 'top.sv', role: 'design', content: generateTopModule({ ports, freqMHz: settings.freqMHz, title }) },
    { name: constraintName, role: 'constraint', content: constraint },
    { name: 'tb_top.sv', role: 'testbench', content: generateTestbench({ ports, freqMHz: settings.freqMHz }) },
  ];
  return {
    name: input.name,
    description: input.description,
    files,
    settings: {
      ...settings,
      constraintFile: constraintName,
      // 虚拟开发板以较低频率仿真：把计数器改小，LED 才能看得到闪烁
      gatesimParams: { CNT_W: Math.max(16, ...leds.map((p) => p.width + 2)) },
    },
    runs: [],
  };
}

/** 从模板创建：使用模板文件与工程设置，缺省项按板卡/器件补全 */
export function buildTemplateProject(input: { name: string; description?: string; example: Example }): ProjectInput {
  const { example } = input;
  const files = example.files.map((f) => ({ ...f, role: f.role ?? inferRole(f.name) }));
  const p = example.project;
  const board = getBoard(p?.board ?? example.board);
  const device = getDevice(p?.device) ?? getDevice(board?.device) ?? getDevice('ice40-up5k-sg48')!;
  const base = defaultSettings(device, board && board.device === device.id ? board : undefined);
  const design = moduleInfo(files, ['design']);
  const tb = moduleInfo(files, ['testbench']);
  const constraints = files.filter((f) => roleOf(f) === 'constraint').map((f) => f.name);
  const settings: ProjectSettings = {
    ...base,
    ...p,
    device: device.id,
    top: p?.top ?? (design.all.includes('top') ? 'top' : design.tops[0]),
    simTop: p?.simTop ?? tb.tops[0],
    constraintFile:
      p?.constraintFile ?? constraints.find((n) => n.toLowerCase().endsWith(device.constraintExt)) ?? constraints[0],
    freqMHz: p?.freqMHz ?? base.freqMHz,
    synth: { flatten: p?.synth?.flatten ?? true },
    simulate: { standard: '2012', ...(example.simulate ?? {}), ...(p?.simulate ?? {}) },
  };
  return {
    name: input.name,
    description: input.description ?? example.description,
    files,
    settings,
    runs: [],
  };
}
