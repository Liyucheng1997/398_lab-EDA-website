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
  // 1BitSquared iCEBreaker v1.0（含插在 PMOD2 上的 break-off 扩展板：3 个按键 + 5 个 LED）
  {
    id: 'icebreaker',
    name: 'iCEBreaker',
    vendor: '1BitSquared',
    device: 'ice40-up5k-sg48',
    clock: { signal: 'clk', pin: '35', freqMHz: 12 },
    pins: [
      { signal: 'clk', pin: '35', peripheral: 'clock', label: '12 MHz 晶振' },
      { signal: 'led_r_n', pin: '11', peripheral: 'led', label: 'LEDR_N 红灯（低电平点亮）' },
      { signal: 'led_g_n', pin: '37', peripheral: 'led', label: 'LEDG_N 绿灯（低电平点亮）' },
      { signal: 'btn_n', pin: '10', peripheral: 'button', label: 'BTN_N 用户按键（按下为 0）' },
      { signal: 'tx', pin: '9', peripheral: 'uart_tx', label: 'FTDI RX（FPGA 发送）' },
      { signal: 'rx', pin: '6', peripheral: 'uart_rx', label: 'FTDI TX（FPGA 接收）' },
      { signal: 'led[0]', pin: '26', peripheral: 'led', label: 'PMOD2 LED1' },
      { signal: 'led[1]', pin: '27', peripheral: 'led', label: 'PMOD2 LED2' },
      { signal: 'led[2]', pin: '25', peripheral: 'led', label: 'PMOD2 LED3' },
      { signal: 'led[3]', pin: '23', peripheral: 'led', label: 'PMOD2 LED4' },
      { signal: 'led[4]', pin: '21', peripheral: 'led', label: 'PMOD2 LED5' },
      { signal: 'btn[0]', pin: '20', peripheral: 'button', label: 'PMOD2 BTN1' },
      { signal: 'btn[1]', pin: '19', peripheral: 'button', label: 'PMOD2 BTN2' },
      { signal: 'btn[2]', pin: '18', peripheral: 'button', label: 'PMOD2 BTN3' },
    ],
    virtual: { leds: 7, switches: 0, buttons: 4, sevenSegDigits: 0, rgb: 0 },
    url: 'https://1bitsquared.com/products/icebreaker',
  },
  // Lattice iCEstick 评估套件（iCE40HX1K-TQ144）：4 个红色 LED 围成一圈 + 中央绿色 LED
  {
    id: 'icestick',
    name: 'iCEstick',
    vendor: 'Lattice',
    device: 'ice40-hx1k-tq144',
    clock: { signal: 'clk', pin: '21', freqMHz: 12 },
    pins: [
      { signal: 'clk', pin: '21', peripheral: 'clock', label: '12 MHz 晶振' },
      { signal: 'led[0]', pin: '99', peripheral: 'led', label: 'D1 红' },
      { signal: 'led[1]', pin: '98', peripheral: 'led', label: 'D2 红' },
      { signal: 'led[2]', pin: '97', peripheral: 'led', label: 'D3 红' },
      { signal: 'led[3]', pin: '96', peripheral: 'led', label: 'D4 红' },
      { signal: 'led[4]', pin: '95', peripheral: 'led', label: 'D5 绿（中央）' },
      { signal: 'tx', pin: '8', peripheral: 'uart_tx', label: 'FTDI RXD（FPGA 发送）' },
      { signal: 'rx', pin: '9', peripheral: 'uart_rx', label: 'FTDI TXD（FPGA 接收）' },
    ],
    virtual: { leds: 5, switches: 0, buttons: 0, sevenSegDigits: 0, rgb: 0 },
    url: 'https://www.latticesemi.com/icestick',
  },
  // Lattice iCE40-HX8K Breakout Board（iCE40HX8K-CT256）：8 个红色 LED
  {
    id: 'ice40-hx8k-breakout',
    name: 'iCE40-HX8K Breakout',
    vendor: 'Lattice',
    device: 'ice40-hx8k-ct256',
    clock: { signal: 'clk', pin: 'J3', freqMHz: 12 },
    pins: [
      { signal: 'clk', pin: 'J3', peripheral: 'clock', label: '12 MHz 晶振' },
      { signal: 'led[0]', pin: 'B5', peripheral: 'led', label: 'D9' },
      { signal: 'led[1]', pin: 'B4', peripheral: 'led', label: 'D8' },
      { signal: 'led[2]', pin: 'A2', peripheral: 'led', label: 'D7' },
      { signal: 'led[3]', pin: 'A1', peripheral: 'led', label: 'D6' },
      { signal: 'led[4]', pin: 'C5', peripheral: 'led', label: 'D5' },
      { signal: 'led[5]', pin: 'C4', peripheral: 'led', label: 'D4' },
      { signal: 'led[6]', pin: 'B3', peripheral: 'led', label: 'D3' },
      { signal: 'led[7]', pin: 'C3', peripheral: 'led', label: 'D2' },
      { signal: 'tx', pin: 'B12', peripheral: 'uart_tx', label: 'FTDI B 通道 RXD（FPGA 发送）' },
      { signal: 'rx', pin: 'B10', peripheral: 'uart_rx', label: 'FTDI B 通道 TXD（FPGA 接收）' },
    ],
    virtual: { leds: 8, switches: 0, buttons: 0, sevenSegDigits: 0, rgb: 0 },
    url: 'https://www.latticesemi.com/Products/DevelopmentBoardsAndKits/iCE40HX8KBreakoutBoard',
  },
  // Radiona ULX3S（LFE5U-85F-6BG381C）：8 LED、4 位拨码开关、7 个按键（PWR 键低有效，作复位）
  {
    id: 'ulx3s',
    name: 'ULX3S (85F)',
    vendor: 'Radiona',
    device: 'ecp5-85k-cabga381',
    clock: { signal: 'clk', pin: 'G2', freqMHz: 25 },
    pins: [
      { signal: 'clk', pin: 'G2', peripheral: 'clock', ioStandard: 'LVCMOS33', label: 'clk_25mhz' },
      { signal: 'led[0]', pin: 'B2', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED0' },
      { signal: 'led[1]', pin: 'C2', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED1' },
      { signal: 'led[2]', pin: 'C1', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED2' },
      { signal: 'led[3]', pin: 'D2', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED3' },
      { signal: 'led[4]', pin: 'D1', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED4' },
      { signal: 'led[5]', pin: 'E2', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED5' },
      { signal: 'led[6]', pin: 'E1', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED6' },
      { signal: 'led[7]', pin: 'H3', peripheral: 'led', ioStandard: 'LVCMOS33 DRIVE=4', label: 'LED7' },
      { signal: 'rst_n', pin: 'D6', peripheral: 'button', ioStandard: 'LVCMOS33 PULLMODE=UP', label: 'PWR 键 BTN_PWRn（按下为 0，用作复位）' },
      { signal: 'btn[0]', pin: 'R1', peripheral: 'button', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'F1 (FIRE1)' },
      { signal: 'btn[1]', pin: 'T1', peripheral: 'button', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'F2 (FIRE2)' },
      { signal: 'btn[2]', pin: 'R18', peripheral: 'button', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'UP' },
      { signal: 'btn[3]', pin: 'V1', peripheral: 'button', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'DOWN' },
      { signal: 'btn[4]', pin: 'U1', peripheral: 'button', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'LEFT' },
      { signal: 'btn[5]', pin: 'H16', peripheral: 'button', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'RIGHT' },
      { signal: 'sw[0]', pin: 'E8', peripheral: 'switch', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'SW1' },
      { signal: 'sw[1]', pin: 'D8', peripheral: 'switch', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'SW2' },
      { signal: 'sw[2]', pin: 'D7', peripheral: 'switch', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'SW3' },
      { signal: 'sw[3]', pin: 'E7', peripheral: 'switch', ioStandard: 'LVCMOS33 PULLMODE=DOWN', label: 'SW4' },
      { signal: 'tx', pin: 'L4', peripheral: 'uart_tx', ioStandard: 'LVCMOS33', label: 'ftdi_rxd（FPGA 发送）' },
      { signal: 'rx', pin: 'M1', peripheral: 'uart_rx', ioStandard: 'LVCMOS33', label: 'ftdi_txd（FPGA 接收）' },
    ],
    virtual: { leds: 8, switches: 4, buttons: 7, sevenSegDigits: 0, rgb: 0 },
    url: 'https://radiona.org/ulx3s/',
  },
  // Digilent Basys 3（XC7A35T-1CPG236C）：16 LED、16 拨码开关、5 按键、4 位共阳数码管（段选、位选均低电平有效）
  {
    id: 'basys3',
    name: 'Basys 3',
    vendor: 'Digilent',
    device: 'xc7a35t-cpg236',
    clock: { signal: 'clk', pin: 'W5', freqMHz: 100 },
    pins: [
      { signal: 'clk', pin: 'W5', peripheral: 'clock', ioStandard: 'LVCMOS33', label: '100 MHz 晶振' },
      { signal: 'led[0]', pin: 'U16', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD0' },
      { signal: 'led[1]', pin: 'E19', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD1' },
      { signal: 'led[2]', pin: 'U19', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD2' },
      { signal: 'led[3]', pin: 'V19', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD3' },
      { signal: 'led[4]', pin: 'W18', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD4' },
      { signal: 'led[5]', pin: 'U15', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD5' },
      { signal: 'led[6]', pin: 'U14', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD6' },
      { signal: 'led[7]', pin: 'V14', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD7' },
      { signal: 'led[8]', pin: 'V13', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD8' },
      { signal: 'led[9]', pin: 'V3', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD9' },
      { signal: 'led[10]', pin: 'W3', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD10' },
      { signal: 'led[11]', pin: 'U3', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD11' },
      { signal: 'led[12]', pin: 'P3', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD12' },
      { signal: 'led[13]', pin: 'N3', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD13' },
      { signal: 'led[14]', pin: 'P1', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD14' },
      { signal: 'led[15]', pin: 'L1', peripheral: 'led', ioStandard: 'LVCMOS33', label: 'LD15' },
      { signal: 'sw[0]', pin: 'V17', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW0' },
      { signal: 'sw[1]', pin: 'V16', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW1' },
      { signal: 'sw[2]', pin: 'W16', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW2' },
      { signal: 'sw[3]', pin: 'W17', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW3' },
      { signal: 'sw[4]', pin: 'W15', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW4' },
      { signal: 'sw[5]', pin: 'V15', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW5' },
      { signal: 'sw[6]', pin: 'W14', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW6' },
      { signal: 'sw[7]', pin: 'W13', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW7' },
      { signal: 'sw[8]', pin: 'V2', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW8' },
      { signal: 'sw[9]', pin: 'T3', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW9' },
      { signal: 'sw[10]', pin: 'T2', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW10' },
      { signal: 'sw[11]', pin: 'R3', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW11' },
      { signal: 'sw[12]', pin: 'W2', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW12' },
      { signal: 'sw[13]', pin: 'U1', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW13' },
      { signal: 'sw[14]', pin: 'T1', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW14' },
      { signal: 'sw[15]', pin: 'R2', peripheral: 'switch', ioStandard: 'LVCMOS33', label: 'SW15' },
      { signal: 'btn[0]', pin: 'U18', peripheral: 'button', ioStandard: 'LVCMOS33', label: 'BTNC 中' },
      { signal: 'btn[1]', pin: 'T18', peripheral: 'button', ioStandard: 'LVCMOS33', label: 'BTNU 上' },
      { signal: 'btn[2]', pin: 'W19', peripheral: 'button', ioStandard: 'LVCMOS33', label: 'BTNL 左' },
      { signal: 'btn[3]', pin: 'T17', peripheral: 'button', ioStandard: 'LVCMOS33', label: 'BTNR 右' },
      { signal: 'btn[4]', pin: 'U17', peripheral: 'button', ioStandard: 'LVCMOS33', label: 'BTND 下' },
      { signal: 'seg_n[0]', pin: 'W7', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'CA (a)' },
      { signal: 'seg_n[1]', pin: 'W6', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'CB (b)' },
      { signal: 'seg_n[2]', pin: 'U8', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'CC (c)' },
      { signal: 'seg_n[3]', pin: 'V8', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'CD (d)' },
      { signal: 'seg_n[4]', pin: 'U5', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'CE (e)' },
      { signal: 'seg_n[5]', pin: 'V5', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'CF (f)' },
      { signal: 'seg_n[6]', pin: 'U7', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'CG (g)' },
      { signal: 'seg_n[7]', pin: 'V7', peripheral: 'seg', ioStandard: 'LVCMOS33', label: 'DP' },
      { signal: 'an_n[0]', pin: 'U2', peripheral: 'digit', ioStandard: 'LVCMOS33', label: 'AN0（最右）' },
      { signal: 'an_n[1]', pin: 'U4', peripheral: 'digit', ioStandard: 'LVCMOS33', label: 'AN1' },
      { signal: 'an_n[2]', pin: 'V4', peripheral: 'digit', ioStandard: 'LVCMOS33', label: 'AN2' },
      { signal: 'an_n[3]', pin: 'W4', peripheral: 'digit', ioStandard: 'LVCMOS33', label: 'AN3（最左）' },
      { signal: 'tx', pin: 'A18', peripheral: 'uart_tx', ioStandard: 'LVCMOS33', label: 'RsTx（FPGA 发送）' },
      { signal: 'rx', pin: 'B18', peripheral: 'uart_rx', ioStandard: 'LVCMOS33', label: 'RsRx（FPGA 接收）' },
    ],
    virtual: { leds: 16, switches: 16, buttons: 5, sevenSegDigits: 4, rgb: 0 },
    url: 'https://digilent.com/reference/programmable-logic/basys-3/start',
  },
  // Sipeed Tang Nano 9K（GW1NR-LV9QN88PC6/I5）：6 个低电平点亮 LED、2 个按键（按下为 0）；LED 与按键位于 1.8 V Bank
  {
    id: 'tang-nano-9k',
    name: 'Tang Nano 9K',
    vendor: 'Sipeed',
    device: 'gw1nr9-qn88p',
    clock: { signal: 'clk', pin: '52', freqMHz: 27 },
    pins: [
      { signal: 'clk', pin: '52', peripheral: 'clock', ioStandard: 'LVCMOS33', label: '27 MHz 晶振' },
      { signal: 'led_n[0]', pin: '10', peripheral: 'led', ioStandard: 'LVCMOS18', label: 'LED0' },
      { signal: 'led_n[1]', pin: '11', peripheral: 'led', ioStandard: 'LVCMOS18', label: 'LED1' },
      { signal: 'led_n[2]', pin: '13', peripheral: 'led', ioStandard: 'LVCMOS18', label: 'LED2' },
      { signal: 'led_n[3]', pin: '14', peripheral: 'led', ioStandard: 'LVCMOS18', label: 'LED3' },
      { signal: 'led_n[4]', pin: '15', peripheral: 'led', ioStandard: 'LVCMOS18', label: 'LED4' },
      { signal: 'led_n[5]', pin: '16', peripheral: 'led', ioStandard: 'LVCMOS18', label: 'LED5' },
      { signal: 'btn_n[0]', pin: '3', peripheral: 'button', ioStandard: 'LVCMOS18', label: 'S1' },
      { signal: 'btn_n[1]', pin: '4', peripheral: 'button', ioStandard: 'LVCMOS18', label: 'S2' },
      { signal: 'tx', pin: '17', peripheral: 'uart_tx', ioStandard: 'LVCMOS33', label: 'BL702 UART RX（FPGA 发送）' },
      { signal: 'rx', pin: '18', peripheral: 'uart_rx', ioStandard: 'LVCMOS33', label: 'BL702 UART TX（FPGA 接收）' },
    ],
    virtual: { leds: 6, switches: 0, buttons: 2, sevenSegDigits: 0, rgb: 0 },
    url: 'https://wiki.sipeed.com/hardware/en/tang/Tang-Nano-9K/Nano-9K.html',
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
