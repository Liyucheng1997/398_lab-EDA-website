/**
 * 门级网表格式：服务端 gatesim 任务产出，浏览器虚拟开发板直接仿真。
 *
 * 约定：
 * - 网络（net）用整数编号；0 号恒为逻辑 0，1 号恒为逻辑 1（Yosys 的 "x"/"z" 常量也映射到 0）。
 * - 多位端口 bits 数组按 LSB→MSB 排列。
 * - 组合门全部为 1 位；DFF 也为 1 位（Yosys 已 simplemap 拆位）。
 * - 设计已展平（无层次），存储器已 memory_map 成触发器。
 */

export type GateType =
  | 'BUF'    // Y = A
  | 'NOT'    // Y = ~A
  | 'AND'    // Y = A & B
  | 'OR'     // Y = A | B
  | 'XOR'    // Y = A ^ B
  | 'NAND'
  | 'NOR'
  | 'XNOR'
  | 'ANDNOT' // Y = A & ~B
  | 'ORNOT'  // Y = A | ~B
  | 'MUX';   // Y = S ? B : A

export interface CombGate {
  type: GateType;
  /** 输入 net：BUF/NOT 只用 a；MUX 用 a,b,s */
  a: number;
  b?: number;
  s?: number;
  y: number;
}

export interface FlipFlop {
  type: 'DFF';
  clk: number;
  /** 1 = 上升沿触发，0 = 下降沿 */
  clkPol: 0 | 1;
  d: number;
  q: number;
  /** 时钟使能（可选），enPol 为有效电平 */
  en?: number;
  enPol?: 0 | 1;
  /** 异步复位/置位（可选）：arst 有效时 q = arstVal */
  arst?: number;
  arstPol?: 0 | 1;
  arstVal?: 0 | 1;
  /** 同步复位（可选）：srst 有效且时钟沿到来时 q = srstVal（优先于 en，与 Yosys $_SDFF_/$_SDFFE_ 语义一致） */
  srst?: number;
  srstPol?: 0 | 1;
  srstVal?: 0 | 1;
  /** 初值（来自 initial / reg x = v），缺省为 0 */
  init?: 0 | 1;
}

export interface Latch {
  type: 'LATCH';
  en: number;
  enPol: 0 | 1;
  d: number;
  q: number;
  init?: 0 | 1;
}

export type GateCell = CombGate | FlipFlop | Latch;

export interface GatePort {
  name: string;
  direction: 'input' | 'output' | 'inout';
  /** LSB 在前 */
  bits: number[];
}

export interface GateNetlist {
  top: string;
  /** 最大 net 编号 + 1 */
  netCount: number;
  ports: GatePort[];
  /** 组合门已按拓扑序排列（服务端排好；有组合环时 combinationalLoop=true 且保持原序） */
  cells: GateCell[];
  combinationalLoop: boolean;
  /** 可选：net 编号 → 可读名（只保留用户命名的线网，用于调试/探针） */
  netNames?: Record<number, string>;
  stats: { gates: number; flipflops: number; latches: number };
}
