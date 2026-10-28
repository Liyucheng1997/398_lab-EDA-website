/**
 * WebEDA 前后端接口契约（唯一事实来源）。
 * server 与 client 都只通过这里的类型通信；修改字段必须两端同步。
 *
 * REST 一览（全部 JSON，前缀 /api）：
 *   GET    /api/tools                          -> ToolInfo[]
 *   POST   /api/jobs                           JobRequest -> { id: string }
 *   GET    /api/jobs/:id                       -> JobInfo
 *   GET    /api/jobs/:id/events                Server-Sent Events，见 JobEvent
 *   POST   /api/jobs/:id/cancel                -> { ok: true }
 *   GET    /api/jobs/:id/artifacts/:name       原样下载产物（VCD、SVG、bin…）
 *   GET    /api/examples                       -> ExampleSummary[]
 *   GET    /api/examples/:id                   -> Example
 *   POST   /api/playgrounds                    PlaygroundInput -> Playground
 *   GET    /api/playgrounds/:id                -> Playground
 *   PUT    /api/playgrounds/:id                PlaygroundInput -> Playground
 *   GET    /api/projects                       -> ProjectSummary[]
 *   POST   /api/projects                       ProjectInput -> Project
 *   GET    /api/projects/:id                   -> Project
 *   PUT    /api/projects/:id                   ProjectInput -> Project
 *   DELETE /api/projects/:id                   -> { ok: true }
 *
 * 错误统一返回 HTTP 4xx/5xx + ApiError。
 */

import type { DeviceId } from './devices';

export interface ApiError {
  error: string;
}

/* ───────────────────────── 源文件 ───────────────────────── */

export type FileRole = 'design' | 'testbench' | 'constraint' | 'include' | 'memory' | 'other';

export interface SourceFile {
  /** 纯文件名，可带一级子目录，如 "rtl/alu.sv"；禁止 ".." 和绝对路径 */
  name: string;
  content: string;
  /** 不填时按扩展名与文件名推断：*.pcf/*.lpf/*.xdc → constraint；名字含 tb/test → testbench；*.vh/*.svh → include；*.hex/*.mem → memory */
  role?: FileRole;
}

/* ───────────────────────── 诊断 ───────────────────────── */

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** 对应 SourceFile.name；工具内部消息可为空 */
  file?: string;
  line?: number;
  column?: number;
  /** 'iverilog' | 'vvp' | 'yosys' | 'nextpnr' | 'icepack' | 'ecppack' | 'webeda' */
  tool: string;
}

/* ───────────────────────── 任务（Job） ───────────────────────── */

export type JobKind =
  | 'simulate'   // Icarus Verilog 编译 + vvp 运行，产出 VCD
  | 'elaborate'  // Yosys prep → RTL 原理图（netlistsvg SVG）
  | 'synthesize' // Yosys 综合到目标器件，产出资源报告 + 综合后原理图
  | 'implement'  // 综合 + nextpnr 布局布线（+ 可选比特流）
  | 'gatesim'    // Yosys 综合到通用门级网表，供浏览器虚拟开发板仿真
  | 'yosys';     // 任意 Yosys 脚本（类 Vivado Tcl Console）

export interface SimulateOptions {
  /** 仿真顶层模块；为空时由 iverilog 自动选择未被实例化的模块 */
  top?: string;
  /** 语言标准，默认 '2012'（SystemVerilog 子集） */
  standard?: '1995' | '2001' | '2005' | '2012';
  /** 额外编译参数（会做白名单校验，只允许 -D -P -W -g -I 等） */
  compileFlags?: string;
  /** 额外运行参数（传给 vvp 的 plusargs，如 +SEED=1） */
  runFlags?: string;
  /** 自动在顶层注入 $dumpfile/$dumpvars（当源码中没有 $dumpfile 时），默认 true */
  autoDump?: boolean;
  /** 超时秒数，默认 30，最大 120 */
  timeoutSec?: number;
}

export interface ElaborateOptions {
  top?: string;
  /** 是否展平层次，默认 false（显示顶层模块，子模块为方框） */
  flatten?: boolean;
  /** 想看原理图的模块；默认 = top */
  module?: string;
}

export type SynthTarget = 'generic' | 'ice40' | 'ecp5' | 'xc7' | 'gowin';

export interface SynthesizeOptions {
  top?: string;
  target: SynthTarget;
  flatten?: boolean;
  /** 是否额外生成综合后原理图 SVG（大设计会很慢，默认 true，超过 3000 单元自动跳过） */
  schematic?: boolean;
}

export interface ImplementOptions {
  top?: string;
  device: DeviceId;
  /** 约束文件名（必须在 files 中），iCE40 用 .pcf，ECP5 用 .lpf */
  constraintFile?: string;
  /** 目标时钟频率 MHz，默认 12 */
  freqMHz?: number;
  /** 是否生成比特流，默认 true */
  bitstream?: boolean;
  /** nextpnr 随机种子 */
  seed?: number;
}

export interface GatesimOptions {
  top?: string;
}

export interface YosysOptions {
  /** Yosys 脚本，多行；files 会被放到工作目录 */
  script: string;
}

export type JobRequest =
  | { kind: 'simulate'; files: SourceFile[]; options: SimulateOptions }
  | { kind: 'elaborate'; files: SourceFile[]; options: ElaborateOptions }
  | { kind: 'synthesize'; files: SourceFile[]; options: SynthesizeOptions }
  | { kind: 'implement'; files: SourceFile[]; options: ImplementOptions }
  | { kind: 'gatesim'; files: SourceFile[]; options: GatesimOptions }
  | { kind: 'yosys'; files: SourceFile[]; options: YosysOptions };

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 任务产物：通过 /api/jobs/:id/artifacts/:name 下载 */
export interface Artifact {
  name: string;
  /** 字节数 */
  size: number;
  /** 'vcd' | 'svg' | 'json' | 'bitstream' | 'text' | 'verilog' */
  kind: 'vcd' | 'svg' | 'json' | 'bitstream' | 'text' | 'verilog';
  /** 人类可读描述，如 "RTL 原理图" */
  label: string;
}

/* ---------- 报告 ---------- */

export interface UtilizationRow {
  /** 资源名：LUT4 / LUT6 / FF / CARRY / BRAM / DSP / IO / PLL / LC / … */
  resource: string;
  used: number;
  /** 器件可用总量；未知时为 null（如 generic 目标） */
  available: number | null;
}

export interface UtilizationReport {
  target: SynthTarget;
  device?: DeviceId;
  rows: UtilizationRow[];
  /** Yosys stat 中原始单元计数 cellType -> count */
  cells: Record<string, number>;
  /** 每个模块的单元数（未展平时） */
  modules?: Record<string, number>;
}

export interface TimingPathStep {
  from: string;
  to: string;
  /** 'clk-to-q' | 'routing' | 'logic' | 'setup' 等 */
  type: string;
  delayNs: number;
  net?: string;
  /** 源码位置，如 "design.sv:12.3-12.20" */
  source?: string;
}

export interface ClockTiming {
  clock: string;
  /** 实际达到的 Fmax（MHz） */
  achievedMHz: number;
  /** 约束频率（MHz） */
  constraintMHz: number;
  /** WNS = 1000/constraint - 1000/achieved（ns），负数表示违例 */
  slackNs: number;
  passed: boolean;
}

export interface TimingReport {
  clocks: ClockTiming[];
  /** 关键路径（最多 5 条） */
  criticalPaths: {
    from: string;
    to: string;
    totalDelayNs: number;
    steps: TimingPathStep[];
  }[];
}

/** 布局结果，用于器件视图（Device View） */
export interface PlacementInfo {
  device: DeviceId;
  /** 网格尺寸（tile 数） */
  width: number;
  height: number;
  /** 每个被占用的 BEL */
  cells: {
    name: string;
    /** 'LC' | 'IO' | 'RAM' | 'DSP' | 'PLL' | 'GB' | 'SLICE' | 'OTHER' */
    type: string;
    x: number;
    y: number;
    z: number;
  }[];
  /** 布线后的连线段（可选，抽样后不超过 5000 条），每条为 tile 坐标 */
  wires?: { x1: number; y1: number; x2: number; y2: number; net: string }[];
}

/* ---------- 各类任务的结果 ---------- */

export interface JobResultBase {
  diagnostics: Diagnostic[];
  artifacts: Artifact[];
  durationMs: number;
}

export interface SimulateResult extends JobResultBase {
  kind: 'simulate';
  /** vvp 退出码 */
  exitCode: number | null;
  /** VCD 产物名（若生成），一般为 "dump.vcd" */
  vcd?: string;
  /** 仿真是否被超时中止 */
  timedOut: boolean;
}

export interface ElaborateResult extends JobResultBase {
  kind: 'elaborate';
  top: string;
  /** 设计中的模块层次 */
  hierarchy: HierarchyNode;
  /** 原理图 SVG 产物名，key = 模块名 */
  schematics: Record<string, string>;
}

export interface HierarchyNode {
  module: string;
  /** 实例名；顶层为 module 名 */
  instance: string;
  children: HierarchyNode[];
}

export interface SynthesizeResult extends JobResultBase {
  kind: 'synthesize';
  top: string;
  utilization: UtilizationReport;
  /** 综合后原理图 SVG 产物名（可能因规模过大被跳过） */
  schematic?: string;
  /** 综合后网表 JSON 产物名 */
  netlist: string;
}

export interface ImplementResult extends JobResultBase {
  kind: 'implement';
  top: string;
  device: DeviceId;
  utilization: UtilizationReport;
  timing: TimingReport;
  /** PlacementInfo JSON 产物名 */
  placement?: string;
  /** 比特流产物名（.bin / .bit） */
  bitstream?: string;
  /** 各阶段耗时 ms：synth / pnr / bitstream */
  stages: { name: string; durationMs: number; ok: boolean }[];
}

export interface GatesimResult extends JobResultBase {
  kind: 'gatesim';
  top: string;
  /** GateNetlist JSON 产物名（见 netlist.ts） */
  netlist: string;
}

export interface YosysResult extends JobResultBase {
  kind: 'yosys';
  exitCode: number;
}

export type JobResult =
  | SimulateResult
  | ElaborateResult
  | SynthesizeResult
  | ImplementResult
  | GatesimResult
  | YosysResult;

export interface JobInfo {
  id: string;
  kind: JobKind;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** 结束后才有；失败时也尽量给出 diagnostics */
  result?: JobResult;
  /** 失败原因的简短描述 */
  error?: string;
}

/**
 * SSE 事件（event 字段 = type，data 字段 = JSON）。
 * 连接建立时服务端会先补发该任务已有的全部 log，再推送新事件；
 * 任务结束时推送一次 'end' 后关闭连接。
 */
export type JobEvent =
  | { type: 'log'; stream: 'stdout' | 'stderr' | 'info'; text: string; ts: number }
  | { type: 'status'; status: JobStatus; stage?: string }
  | { type: 'end'; job: JobInfo };

/* ───────────────────────── 工具信息 ───────────────────────── */

export interface ToolInfo {
  id: 'iverilog' | 'yosys' | 'nextpnr-ice40' | 'nextpnr-ecp5' | 'icepack' | 'ecppack' | 'netlistsvg';
  name: string;
  version: string | null;
  available: boolean;
  /** native = 本机可执行文件；wasm = YoWASP WebAssembly；js = Node 库 */
  runtime: 'native' | 'wasm' | 'js';
}

/* ───────────────────────── 示例 ───────────────────────── */

export type ExampleCategory = 'basics' | 'combinational' | 'sequential' | 'fsm' | 'memory' | 'interface' | 'verification' | 'board';

export interface ExampleSummary {
  id: string;
  title: string;
  description: string;
  category: ExampleCategory;
  /** 适用页面：playground = 仿真示例；studio = FPGA 工程模板 */
  scope: 'playground' | 'studio' | 'both';
  /** studio 模板的推荐板卡 */
  board?: string;
}

export interface Example extends ExampleSummary {
  files: SourceFile[];
  /** playground 设置 */
  simulate?: SimulateOptions;
  /** studio 工程默认设置 */
  project?: ProjectSettings;
}

/* ───────────────────────── Playground（类 EDA Playground） ───────────────────────── */

export interface PlaygroundSettings {
  simulator: 'icarus';
  simulate: SimulateOptions;
  /** 运行后自动打开波形 */
  openWaveform: boolean;
  /** 运行后自动生成 RTL 原理图 */
  showSchematic: boolean;
}

export interface PlaygroundInput {
  title: string;
  description?: string;
  files: SourceFile[];
  settings: PlaygroundSettings;
}

export interface Playground extends PlaygroundInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** 从哪个 playground fork 而来 */
  forkedFrom?: string;
}

/* ───────────────────────── Project（类 Vivado 工程） ───────────────────────── */

export interface ProjectSettings {
  device: DeviceId;
  /** 板卡 id（见 devices.ts BOARDS），可为空 */
  board?: string;
  top?: string;
  simTop?: string;
  constraintFile?: string;
  freqMHz: number;
  synth: { flatten: boolean };
  simulate: SimulateOptions;
}

/** 设计运行记录（类 Vivado Design Runs 表） */
export interface RunRecord {
  id: string;
  kind: 'synthesize' | 'implement' | 'simulate';
  jobId: string;
  status: JobStatus;
  startedAt: string;
  durationMs?: number;
  /** 摘要：LUT/FF 数、Fmax 等 */
  summary?: Record<string, string | number>;
}

export interface ProjectInput {
  name: string;
  description?: string;
  files: SourceFile[];
  settings: ProjectSettings;
  runs?: RunRecord[];
}

export interface Project extends ProjectInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  runs: RunRecord[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  device: DeviceId;
  board?: string;
  updatedAt: string;
  fileCount: number;
}
