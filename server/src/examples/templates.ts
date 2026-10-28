import type { DeviceId, Example, ProjectSettings } from '@webeda/shared';
import { boardConstraintFile, loadFiles, requireBoard } from './load';

/**
 * Studio FPGA 工程模板（类 Vivado 新建工程）。
 *
 * 约定：
 * - 顶层端口名遵循虚拟开发板命名（见 shared/src/devices.ts），并与 BOARDS 中的信号名一一对应；
 * - 约束文件由 BOARDS 引脚表按顶层端口自动生成，保证与板卡数据库一致；
 * - 分频系数都由参数（CLK_HZ 等）推导，gatesimParams 把 CLK_HZ 设为 1000，
 *   即「虚拟开发板时钟按 1 kHz 计」：在虚拟板上把时钟调到 1 kHz 时，效果与真实板卡的时间尺度一致。
 */
export interface TemplateDef {
  id: string;
  title: string;
  description: string;
  board: string;
  /** 顶层模块名 */
  top: string;
  /** 顶层端口（用于生成约束，必须全部能在板卡引脚表中找到） */
  ports: string[];
  /** hdl/<id>/ 下的设计与测试平台文件 */
  files: string[];
  /** 生成的约束文件名 */
  constraintFile: string;
  gatesimParams: Record<string, number>;
}

export const TEMPLATE_DEFS: TemplateDef[] = [
  {
    id: 'virtual-starter',
    title: '虚拟开发板入门',
    description:
      '面向浏览器虚拟开发板（Basys 3 布局）的第一个工程：开关点亮 LED、数码管显示十六进制，按键切换显示秒数。无需真实硬件即可体验综合与上板。',
    board: 'basys3',
    top: 'virtual_starter',
    ports: ['clk', 'sw', 'btn', 'led', 'seg_n', 'an_n'],
    files: ['starter.sv', 'tb_starter.sv'],
    constraintFile: 'basys3.xdc',
    gatesimParams: { CLK_HZ: 1000, SCAN_HZ: 500 },
  },
  {
    id: 'icebreaker-blinky',
    title: 'iCEBreaker 闪灯',
    description: 'iCE40 UP5K 入门：红绿 LED 交替闪烁，PMOD2 扩展板 LED 显示秒数，按住按键加速。可完整走通综合、布局布线与比特流。',
    board: 'icebreaker',
    top: 'blinky',
    ports: ['clk', 'btn_n', 'led_r_n', 'led_g_n', 'led'],
    files: ['blinky.sv', 'tb_blinky.sv'],
    constraintFile: 'icebreaker.pcf',
    gatesimParams: { CLK_HZ: 1000 },
  },
  {
    id: 'icebreaker-uart',
    title: 'iCEBreaker 串口 Hello',
    description: '通过 FTDI 串口（115200 8N1）每秒发送一次 "Hello, WebEDA!"，按键立即重发；包含可复用的 UART 发送器与带接收模型的测试平台。',
    board: 'icebreaker',
    top: 'uart_hello',
    ports: ['clk', 'btn_n', 'tx', 'led_g_n'],
    files: ['uart_hello.sv', 'uart_tx.sv', 'tb_uart_hello.sv'],
    constraintFile: 'icebreaker.pcf',
    gatesimParams: { CLK_HZ: 1000, BAUD: 100 },
  },
  {
    id: 'icestick-chaser',
    title: 'iCEstick 流水灯',
    description: 'iCE40 HX1K：环形排列的 4 个红色 LED 依次旋转，中央绿色 LED 每秒闪烁一次。',
    board: 'icestick',
    top: 'led_chaser',
    ports: ['clk', 'led'],
    files: ['led_chaser.sv', 'tb_led_chaser.sv'],
    constraintFile: 'icestick.pcf',
    gatesimParams: { CLK_HZ: 1000 },
  },
  {
    id: 'hx8k-counter',
    title: 'iCE40-HX8K 计数器',
    description: 'iCE40-HX8K Breakout 的 8 个 LED 显示二进制计数（参数 GRAY = 1 可切换为格雷码）。',
    board: 'ice40-hx8k-breakout',
    top: 'led_counter',
    ports: ['clk', 'led'],
    files: ['led_counter.sv', 'tb_led_counter.sv'],
    constraintFile: 'ice40-hx8k.pcf',
    gatesimParams: { CLK_HZ: 1000 },
  },
  {
    id: 'ulx3s-led-button',
    title: 'ULX3S LED 与按键',
    description: 'ECP5 85F：4 种 LED 动画，6 个按键控制暂停、切换、速度与方向，拨码开关控制取反、镜像与亮度，PWR 键复位。',
    board: 'ulx3s',
    top: 'ulx3s_demo',
    ports: ['clk', 'rst_n', 'btn', 'sw', 'led'],
    files: ['ulx3s_demo.sv', 'debounce.sv', 'tb_ulx3s_demo.sv'],
    constraintFile: 'ulx3s.lpf',
    gatesimParams: { CLK_HZ: 1000 },
  },
  {
    id: 'basys3-stopwatch',
    title: 'Basys 3 秒表与数码管',
    description: 'Artix-7（仅综合）：开关驱动 LED，4 位数码管动态扫描显示秒表（开始/暂停、清零、计次）或开关的十六进制值。非常适合在虚拟开发板上运行。',
    board: 'basys3',
    top: 'basys3_stopwatch',
    ports: ['clk', 'sw', 'btn', 'led', 'seg_n', 'an_n'],
    files: ['basys3_stopwatch.sv', 'seg7_scan.sv', 'debounce.sv', 'tb_basys3_stopwatch.sv'],
    constraintFile: 'basys3.xdc',
    gatesimParams: { CLK_HZ: 1000, SCAN_HZ: 500 },
  },
  {
    id: 'tangnano9k-blinky',
    title: 'Tang Nano 9K 闪灯',
    description: 'Gowin GW1NR-9（仅综合）：6 个 LED 显示二进制计数，S1 暂停、S2 清零。',
    board: 'tang-nano-9k',
    top: 'blinky',
    ports: ['clk', 'btn_n', 'led_n'],
    files: ['blinky.sv', 'tb_blinky.sv'],
    constraintFile: 'tangnano9k.cst',
    gatesimParams: { CLK_HZ: 1000 },
  },
];

function buildTemplate(d: TemplateDef): Example {
  const board = requireBoard(d.board);
  const device: DeviceId = board.device;
  const project: ProjectSettings = {
    device,
    board: board.id,
    top: d.top,
    simTop: 'tb',
    constraintFile: d.constraintFile,
    freqMHz: board.clock.freqMHz,
    synth: { flatten: true },
    simulate: { standard: '2012', top: 'tb', timeoutSec: 60 },
    gatesimParams: { ...d.gatesimParams },
  };
  const sources = loadFiles(d.id, d.files);
  const design = sources.filter((f) => f.role !== 'testbench');
  const testbenches = sources.filter((f) => f.role === 'testbench');
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    category: 'board',
    scope: 'studio',
    board: board.id,
    files: [...design, boardConstraintFile(d.board, d.constraintFile, d.ports), ...testbenches],
    simulate: { ...project.simulate },
    project,
  };
}

export const STUDIO_TEMPLATES: Example[] = TEMPLATE_DEFS.map(buildTemplate);
