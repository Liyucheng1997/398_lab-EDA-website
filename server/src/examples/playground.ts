import type { Example, ExampleCategory, SimulateOptions } from '@webeda/shared';
import { loadFiles } from './load';

/**
 * Playground 仿真示例（类 EDA Playground）。
 * 每个示例 = hdl/<id>/ 下的 design.sv + testbench.sv（+ 可选的存储器初值文件），
 * 测试平台顶层统一为 tb，会写出 dump.vcd 并打印 PASS / FAIL。
 */
interface PlaygroundDef {
  id: string;
  title: string;
  description: string;
  category: Exclude<ExampleCategory, 'board'>;
  /** 额外文件（design.sv、testbench.sv 之外） */
  extra?: string[];
  simulate?: Partial<SimulateOptions>;
}

const DEFS: PlaygroundDef[] = [
  // ───────── 入门 ─────────
  {
    id: 'counter',
    title: '4 位计数器',
    description: '带同步复位与计数使能的参数化计数器；自检测试平台逐拍与参考模型比对，覆盖回绕与保持。',
    category: 'basics',
  },
  {
    id: 'hello-world',
    title: 'Hello World',
    description: '最小的设计 + 测试平台，演示 $display 的 %d %h %b %o %c %f %t %m 等格式化输出。',
    category: 'basics',
  },
  {
    id: 'sv-showcase',
    title: 'SystemVerilog 特性展示',
    description: 'package、typedef enum、struct packed、always_ff / always_comb、函数与任务、string、if + $error 断言风格。',
    category: 'basics',
  },
  // ───────── 组合逻辑 ─────────
  {
    id: 'adders',
    title: '半加器与全加器',
    description: '两个半加器 + 或门搭出全加器（结构化描述），穷举测试并打印真值表。',
    category: 'combinational',
  },
  {
    id: 'alu',
    title: '行波进位加法器与 ALU',
    description: 'generate 串联全加器构成 8 位行波进位加法器；ALU 用枚举操作码，支持加减、逻辑、比较、移位与进位/溢出标志，1600 组随机测试。',
    category: 'combinational',
  },
  {
    id: 'mux-decoder',
    title: '多路选择器 / 译码器 / 优先编码器',
    description: '4 选 1 多路选择器、3-8 译码器与 8 输入优先编码器组合在一起，穷举 1024 种输入。',
    category: 'combinational',
  },
  {
    id: 'seven-seg',
    title: '七段数码管译码器',
    description: '十六进制到七段码的译码表，测试平台把 16 个字形用字符画「点亮」出来。',
    category: 'combinational',
  },
  // ───────── 时序逻辑 ─────────
  {
    id: 'shift-lfsr',
    title: '移位寄存器与 LFSR',
    description: '可并行装载、双向移位的移位寄存器；8 位最大长度 LFSR，验证周期恰为 255。',
    category: 'sequential',
  },
  {
    id: 'clock-divider',
    title: '时钟分频器',
    description: '任意整数分频且保持 50% 占空比（奇数分频用双沿技巧），另输出单拍 tick；测试平台测量周期与占空比。',
    category: 'sequential',
  },
  {
    id: 'pwm',
    title: 'PWM 发生器',
    description: '计数器 + 比较器实现 PWM，占空比在周期边界更新避免毛刺；统计多种占空比下的高电平拍数。',
    category: 'sequential',
  },
  {
    id: 'debouncer',
    title: '按键消抖',
    description: '两级同步 + 稳定计数的消抖电路，输出电平与按下/松开脉冲；测试平台模拟随机机械抖动。',
    category: 'sequential',
  },
  {
    id: 'cdc-sync',
    title: '跨时钟域同步器',
    description: '两级触发器同步器与翻转式脉冲同步器，在 100 MHz 与 37 MHz 两个异步时钟间传递信号。',
    category: 'sequential',
  },
  // ───────── 状态机 ─────────
  {
    id: 'seq-detector',
    title: '序列检测器（Moore 与 Mealy）',
    description: '分别用 Moore 型与 Mealy 型状态机检测可重叠的 "1011"，对比输出时序；随机比特流与参考模型比对。',
    category: 'fsm',
  },
  {
    id: 'traffic-light',
    title: '交通灯控制器',
    description: '十字路口两相位交通灯，带黄灯、全红与行人请求；测试平台检查安全性与各阶段时长。',
    category: 'fsm',
  },
  {
    id: 'gcd-fib',
    title: 'GCD 与 Fibonacci 数据通路',
    description: '控制器 + 数据通路（FSMD）：辗转相减求最大公约数、迭代计算斐波那契数，start / done 握手。',
    category: 'fsm',
  },
  // ───────── 存储器 ─────────
  {
    id: 'sync-fifo',
    title: '同步 FIFO',
    description: '环形缓冲区 + 扩展 1 位的读写指针判断满 / 空；定向测试加 1000 拍随机读写，记分板比对数据顺序。',
    category: 'memory',
  },
  {
    id: 'ram-readmemh',
    title: '单端口 RAM（$readmemh 初始化）',
    description: '可推断为 BRAM 的同步 RAM，用 $readmemh 从 ram_init.hex 加载初值；验证初值、写后读与读优先。',
    category: 'memory',
    extra: ['ram_init.hex'],
  },
  // ───────── 接口 ─────────
  {
    id: 'uart-loopback',
    title: 'UART 收发回环',
    description: '8N1 UART 发送器与接收器（中点采样、帧错误检测），回环发送字符串与随机字节，自检记分板。',
    category: 'interface',
  },
  {
    id: 'spi-master',
    title: 'SPI 主机',
    description: '模式 0 的 8 位 SPI 主机；测试平台内置 SPI 从机模型，同时校验 MOSI 与 MISO 两个方向。',
    category: 'interface',
  },
  // ───────── 验证 ─────────
  {
    id: 'random-scoreboard',
    title: '随机激励与记分板',
    description: '3 级流水乘加器的分层测试平台：驱动任务、$random 约束随机、监视器、记分板与覆盖率统计，最后输出测试报告。',
    category: 'verification',
  },
];

export const PLAYGROUND_EXAMPLES: Example[] = DEFS.map((d) => ({
  id: d.id,
  title: d.title,
  description: d.description,
  category: d.category,
  scope: 'playground',
  files: loadFiles(d.id, ['design.sv', 'testbench.sv', ...(d.extra ?? [])]),
  simulate: { standard: '2012', top: 'tb', ...d.simulate },
}));
