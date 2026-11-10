/**
 * PCB（电路板）设计的数据模型与 AI 设计接口契约。
 *
 * 坐标：单位 mm，原点在板子左上角，x 向右、y 向下。两层铜：F.Cu（顶层）、B.Cu（底层）。
 * 元件都放在顶层，旋转只允许 0/90/180/270（屏幕上顺时针），所以焊盘都是轴对齐的。
 *
 * REST（前缀 /api/pcb）：
 *   GET  /api/pcb/status            -> PcbAiStatus
 *   GET  /api/pcb/example           -> PcbSnapshot（内置示例板，不调用 AI）
 *   POST /api/pcb/runs              PcbRunRequest -> { id }
 *   GET  /api/pcb/runs/:id/events   Server-Sent Events，见 PcbRunEvent
 *   POST /api/pcb/runs/:id/cancel   -> { ok: true }
 */

export type PcbLayer = 'F.Cu' | 'B.Cu';
export type PcbRotation = 0 | 90 | 180 | 270;

export interface PcbRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 焊盘。在封装定义里是相对元件原点的坐标；在 PcbComponent.pads 里是板上的绝对坐标 */
export interface PcbPad {
  /** 引脚号（字符串，如 "1"、"A5"） */
  num: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** rect = 矩形；round = 圆形（w = h）或跑道形 */
  shape: 'rect' | 'round';
  /** 有钻孔 = 通孔焊盘，同时存在于两层 */
  drill?: number;
  /** 所属网络名；未连接时为空 */
  net?: string;
}

/** 封装定义（相对坐标，rotation = 0） */
export interface PcbFootprintDef {
  id: string;
  description: string;
  pads: PcbPad[];
  /** 元件占位（courtyard），相对元件原点 */
  body: PcbRect;
}

export interface PcbComponent {
  /** 位号，如 R1、U2 */
  ref: string;
  /** 封装 id，如 0603、SOIC-8 */
  footprint: string;
  /** 值或型号，如 10k、NE555 */
  value: string;
  x: number;
  y: number;
  rotation: PcbRotation;
  /** 已按位置与旋转展开的焊盘（绝对坐标） */
  pads: PcbPad[];
  /** 已展开的占位框（绝对坐标） */
  body: PcbRect;
}

export type PcbNetClass = 'signal' | 'power';

export interface PcbNet {
  name: string;
  /** "位号.引脚号"，如 "U1.8" */
  pins: string[];
  class: PcbNetClass;
}

export interface PcbTrace {
  net: string;
  layer: PcbLayer;
  width: number;
  points: [number, number][];
}

export interface PcbVia {
  net: string;
  x: number;
  y: number;
  diameter: number;
  drill: number;
}

export interface PcbText {
  text: string;
  x: number;
  y: number;
  /** 字高 mm */
  size: number;
}

export interface PcbHole {
  x: number;
  y: number;
  diameter: number;
}

export interface PcbRules {
  /** 不同网络的铜之间的最小间距 */
  clearance: number;
  traceWidth: number;
  powerTraceWidth: number;
  viaDiameter: number;
  viaDrill: number;
  /** 铜到板边的最小距离 */
  edgeClearance: number;
}

export const DEFAULT_PCB_RULES: PcbRules = {
  clearance: 0.2,
  traceWidth: 0.25,
  powerTraceWidth: 0.5,
  viaDiameter: 0.6,
  viaDrill: 0.3,
  edgeClearance: 0.3,
};

export interface PcbDesign {
  name: string;
  description: string;
  width: number;
  height: number;
  holes: PcbHole[];
  components: PcbComponent[];
  nets: PcbNet[];
  traces: PcbTrace[];
  vias: PcbVia[];
  texts: PcbText[];
  rules: PcbRules;
  /** 设计中自定义的封装（内置封装库之外） */
  customFootprints: PcbFootprintDef[];
}

/* ───────────────────────── DRC ───────────────────────── */

export type PcbViolationType =
  | 'unconnected' // 网络没有连通
  | 'short' // 不同网络的铜相碰
  | 'clearance' // 间距不足
  | 'overlap' // 元件占位重叠
  | 'outside' // 元件超出板框
  | 'edge' // 铜离板边太近
  | 'hole'; // 铜或元件压到安装孔

export interface PcbViolation {
  type: PcbViolationType;
  severity: 'error' | 'warning';
  message: string;
  /** 违例位置（用于在板图上标记） */
  x?: number;
  y?: number;
  refs?: string[];
  nets?: string[];
}

export interface PcbDrcReport {
  violations: PcbViolation[];
  errors: number;
  warnings: number;
  /** 还缺多少条连接（各网络的连通块数 - 1 之和） */
  unrouted: number;
  /** 飞线：每条缺失连接的一对最近焊盘 */
  ratsnest: { net: string; x1: number; y1: number; x2: number; y2: number }[];
}

export interface PcbSnapshot {
  design: PcbDesign;
  drc: PcbDrcReport;
}

/* ───────────────────────── AI 设计 ───────────────────────── */

export interface PcbAiStatus {
  /** 服务端是否配置了 Claude API 凭据 */
  available: boolean;
  model: string;
  effort: string;
  /** 不可用时的原因 */
  reason?: string;
}

export interface PcbRunRequest {
  /** 用自然语言描述想要的电路板，或对现有设计的修改要求 */
  prompt: string;
  /** 在已有设计上继续修改时传入 */
  design?: PcbDesign;
}

export type PcbRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface PcbUsage {
  /** 模型调用轮数 */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * SSE 事件（event 字段 = type，data 字段 = JSON）。
 * 连接建立时服务端会补发已有事件；结束时推送一次 'end' 后关闭连接。
 */
export type PcbRunEvent =
  /** 新一轮模型调用开始 */
  | { type: 'turn'; turn: number }
  /** 模型的文字说明（增量） */
  | { type: 'text'; text: string }
  /** 模型的思考摘要（增量） */
  | { type: 'thinking'; text: string }
  /** 一次工具调用及其结果 */
  | { type: 'tool'; name: string; summary: string; ok: boolean }
  /** 设计发生变化后的完整快照 */
  | { type: 'design'; design: PcbDesign; drc: PcbDrcReport }
  | { type: 'usage'; usage: PcbUsage }
  | { type: 'end'; status: PcbRunStatus; error?: string; design: PcbDesign; drc: PcbDrcReport; usage: PcbUsage; model: string };
