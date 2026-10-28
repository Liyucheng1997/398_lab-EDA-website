/**
 * 器件与板卡数据库。
 * - pnr=true 的器件可以走完整实现流程（nextpnr 布局布线 + 比特流）。
 * - pnr=false 的器件（Xilinx 7 系列、Gowin）只做综合与资源估算——开源工具链暂不支持其布局布线。
 */

export type DeviceFamily = 'ice40' | 'ecp5' | 'xc7' | 'gowin';

export type DeviceId =
  | 'ice40-hx1k-tq144'
  | 'ice40-hx8k-ct256'
  | 'ice40-up5k-sg48'
  | 'ecp5-25k-cabga256'
  | 'ecp5-85k-cabga381'
  | 'xc7a35t-cpg236'
  | 'xc7a100t-csg324'
  | 'gw1nr9-qn88p';

export interface DeviceInfo {
  id: DeviceId;
  family: DeviceFamily;
  /** 展示名，如 "iCE40 UP5K" */
  name: string;
  /** 厂商器件型号，如 "iCE40UP5K-SG48" */
  partNumber: string;
  package: string;
  /** 是否支持布局布线 + 比特流 */
  pnr: boolean;
  /** 传给 nextpnr 的器件参数 */
  nextpnrArgs: string[];
  /** 约束文件扩展名 */
  constraintExt: '.pcf' | '.lpf' | '.xdc' | '.cst';
  /** 资源总量，key 与 UtilizationRow.resource 一致 */
  resources: Record<string, number>;
  /** 比特流打包参数（ecppack 的 --idcode 等），可选 */
  packArgs?: string[];
}

export const DEVICES: DeviceInfo[] = [
  {
    id: 'ice40-hx1k-tq144',
    family: 'ice40',
    name: 'iCE40 HX1K',
    partNumber: 'iCE40HX1K-TQ144',
    package: 'tq144',
    pnr: true,
    nextpnrArgs: ['--hx1k', '--package', 'tq144'],
    constraintExt: '.pcf',
    resources: { LC: 1280, LUT4: 1280, FF: 1280, CARRY: 1280, BRAM: 16, IO: 96, PLL: 1, GB: 8 },
  },
  {
    id: 'ice40-hx8k-ct256',
    family: 'ice40',
    name: 'iCE40 HX8K',
    partNumber: 'iCE40HX8K-CT256',
    package: 'ct256',
    pnr: true,
    nextpnrArgs: ['--hx8k', '--package', 'ct256'],
    constraintExt: '.pcf',
    resources: { LC: 7680, LUT4: 7680, FF: 7680, CARRY: 7680, BRAM: 32, IO: 206, PLL: 2, GB: 8 },
  },
  {
    id: 'ice40-up5k-sg48',
    family: 'ice40',
    name: 'iCE40 UP5K',
    partNumber: 'iCE40UP5K-SG48',
    package: 'sg48',
    pnr: true,
    nextpnrArgs: ['--up5k', '--package', 'sg48'],
    constraintExt: '.pcf',
    resources: { LC: 5280, LUT4: 5280, FF: 5280, CARRY: 5280, BRAM: 30, SPRAM: 4, DSP: 8, IO: 39, PLL: 1, GB: 8 },
  },
  {
    id: 'ecp5-25k-cabga256',
    family: 'ecp5',
    name: 'ECP5 LFE5U-25F',
    partNumber: 'LFE5U-25F-6BG256C',
    package: 'CABGA256',
    pnr: true,
    nextpnrArgs: ['--25k', '--package', 'CABGA256', '--speed', '6'],
    constraintExt: '.lpf',
    resources: { LUT4: 24288, FF: 24288, CARRY: 12144, BRAM: 56, DSP: 28, IO: 197, PLL: 2 },
    packArgs: ['--idcode', '0x41111043'],
  },
  {
    id: 'ecp5-85k-cabga381',
    family: 'ecp5',
    name: 'ECP5 LFE5U-85F',
    partNumber: 'LFE5U-85F-6BG381C',
    package: 'CABGA381',
    pnr: true,
    nextpnrArgs: ['--85k', '--package', 'CABGA381', '--speed', '6'],
    constraintExt: '.lpf',
    resources: { LUT4: 83640, FF: 83640, CARRY: 41820, BRAM: 208, DSP: 156, IO: 205, PLL: 4 },
    packArgs: ['--idcode', '0x41113043'],
  },
  {
    id: 'xc7a35t-cpg236',
    family: 'xc7',
    name: 'Artix-7 35T',
    partNumber: 'XC7A35T-1CPG236C',
    package: 'cpg236',
    pnr: false,
    nextpnrArgs: [],
    constraintExt: '.xdc',
    resources: { LUT6: 20800, FF: 41600, CARRY4: 8150, BRAM: 50, DSP: 90, IO: 106, MMCM: 5 },
  },
  {
    id: 'xc7a100t-csg324',
    family: 'xc7',
    name: 'Artix-7 100T',
    partNumber: 'XC7A100T-1CSG324C',
    package: 'csg324',
    pnr: false,
    nextpnrArgs: [],
    constraintExt: '.xdc',
    resources: { LUT6: 63400, FF: 126800, CARRY4: 15850, BRAM: 135, DSP: 240, IO: 210, MMCM: 6 },
  },
  {
    id: 'gw1nr9-qn88p',
    family: 'gowin',
    name: 'Gowin GW1NR-9',
    partNumber: 'GW1NR-LV9QN88PC6/I5',
    package: 'QN88P',
    pnr: false,
    nextpnrArgs: [],
    constraintExt: '.cst',
    resources: { LUT4: 8640, FF: 6480, ALU: 8640, BSRAM: 26, DSP: 10, IO: 71, PLL: 2 },
  },
];

export function getDevice(id: DeviceId | string | undefined): DeviceInfo | undefined {
  return DEVICES.find((d) => d.id === id);
}

/* ───────────────────────── 板卡 ───────────────────────── */

/**
 * 板载外设种类。虚拟开发板按顶层端口名把外设与设计相连：
 *   led / leds / led[n]          → LED（名字以 _n 结尾则低电平点亮，如 led_n / led_r_n）
 *   sw / sw[n] / switch          → 拨码开关
 *   btn / btn[n] / key / button  → 按键（按下为 1，若端口名以 _n 结尾则按下为 0）
 *   seg[6:0] / seg[7:0]          → 七段数码管段选（a..g[,dp]，默认高电平点亮；_n 结尾为低电平点亮）
 *   an[n] / an_n[n] / dig        → 数码管位选
 *   rgb / rgb_r/g/b / led_r/g/b  → RGB 灯
 *   clk / clk_i / clock / clk12 / clk100 → 时钟（虚拟板以可调频率驱动）
 *   rst / reset / rst_n / resetn → 复位按键
 *   tx / uart_tx                 → 虚拟串口终端（8N1，波特率由界面设定）
 */
export type BoardPeripheral = 'clock' | 'led' | 'rgb' | 'switch' | 'button' | 'seg' | 'digit' | 'uart_tx' | 'uart_rx' | 'pmod' | 'other';

export interface BoardPin {
  /** 约束中的信号名，如 "led[0]" */
  signal: string;
  /** 物理引脚，如 "11"（iCE40）或 "B2"（ECP5/Xilinx） */
  pin: string;
  peripheral: BoardPeripheral;
  /** 可选 IO 标准（ECP5 LPF / Xilinx XDC 用） */
  ioStandard?: string;
  label?: string;
}

export interface BoardInfo {
  id: string;
  name: string;
  vendor: string;
  device: DeviceId;
  /** 板载主时钟 */
  clock: { signal: string; pin: string; freqMHz: number };
  pins: BoardPin[];
  /** 虚拟开发板布局：各外设数量 */
  virtual: { leds: number; switches: number; buttons: number; sevenSegDigits: number; rgb: number };
  url?: string;
}

/** 板卡清单——示例/模板作者负责补全；新增板卡时同时更新 generateConstraints 能生成的格式 */
export const BOARDS: BoardInfo[] = [
  {
    id: 'icebreaker',
    name: 'iCEBreaker',
    vendor: '1BitSquared',
    device: 'ice40-up5k-sg48',
    clock: { signal: 'clk', pin: '35', freqMHz: 12 },
    pins: [
      { signal: 'clk', pin: '35', peripheral: 'clock', label: '12 MHz' },
      { signal: 'led_r', pin: '11', peripheral: 'led', label: 'LEDR_N' },
      { signal: 'led_g', pin: '37', peripheral: 'led', label: 'LEDG_N' },
      { signal: 'btn_n', pin: '10', peripheral: 'button', label: 'BTN_N' },
      { signal: 'tx', pin: '9', peripheral: 'uart_tx', label: 'FTDI RX' },
      { signal: 'rx', pin: '6', peripheral: 'uart_rx', label: 'FTDI TX' },
    ],
    virtual: { leds: 2, switches: 0, buttons: 1, sevenSegDigits: 0, rgb: 0 },
    url: 'https://1bitsquared.com/products/icebreaker',
  },
];

export function getBoard(id: string | undefined): BoardInfo | undefined {
  return BOARDS.find((b) => b.id === id);
}

/** 把板卡引脚表生成为对应格式的约束文件文本（.pcf / .lpf / .xdc / .cst） */
export function generateConstraints(board: BoardInfo, usedSignals?: string[]): string {
  const dev = getDevice(board.device);
  const pins = usedSignals ? board.pins.filter((p) => usedSignals.includes(p.signal)) : board.pins;
  const ext = dev?.constraintExt ?? '.pcf';
  const lines: string[] = [`# ${board.name} (${dev?.partNumber ?? board.device}) — 由 WebEDA 生成`];
  for (const p of pins) {
    const comment = p.label ? `  # ${p.label}` : '';
    if (ext === '.pcf') {
      lines.push(`set_io ${p.signal} ${p.pin}${comment}`);
    } else if (ext === '.lpf') {
      lines.push(`LOCATE COMP "${p.signal}" SITE "${p.pin}";${comment}`);
      lines.push(`IOBUF PORT "${p.signal}" IO_TYPE=${p.ioStandard ?? 'LVCMOS33'};`);
    } else if (ext === '.xdc') {
      const port = p.signal.includes('[') ? `{${p.signal}}` : p.signal;
      lines.push(`set_property -dict { PACKAGE_PIN ${p.pin} IOSTANDARD ${p.ioStandard ?? 'LVCMOS33'} } [get_ports ${port}];${comment}`);
    } else {
      lines.push(`IO_LOC "${p.signal}" ${p.pin};${comment}`);
      lines.push(`IO_PORT "${p.signal}" IO_TYPE=${p.ioStandard ?? 'LVCMOS33'};`);
    }
  }
  if (ext === '.lpf') {
    lines.push(`FREQUENCY PORT "${board.clock.signal}" ${board.clock.freqMHz} MHZ;`);
  } else if (ext === '.xdc') {
    const period = (1000 / board.clock.freqMHz).toFixed(3);
    lines.push(`create_clock -period ${period} -name sys_clk [get_ports ${board.clock.signal}];`);
  }
  return lines.join('\n') + '\n';
}
