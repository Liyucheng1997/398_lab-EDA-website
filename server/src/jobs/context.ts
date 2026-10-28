import type { Artifact, Diagnostic, JobRequest, JobResult, SourceFile } from '@webeda/shared';
import type { RunResult, ToolName } from '../tools/exec';

/**
 * 交给各 flow 的运行上下文。flow 只通过它和外界交互：
 * 读写工作目录、运行工具、写日志、登记产物。
 */
export interface JobContext {
  id: string;
  /** 本任务的独立工作目录，源文件已按 SourceFile.name 写入 */
  workDir: string;
  /** 已校验过的源文件（role 已推断） */
  files: SourceFile[];
  signal: AbortSignal;
  /** 写一行到任务日志（'info' 用于 WebEDA 自己的提示，如 "▶ 运行 iverilog …"） */
  log(stream: 'stdout' | 'stderr' | 'info', text: string): void;
  /** 报告当前阶段（UI 显示在进度条上），如 'synth' / 'pnr' / 'bitstream' */
  stage(name: string): void;
  /**
   * 运行一个工具，输出实时进入任务日志。
   * timeoutSec 缺省为 config.limits.toolTimeoutSec。
   * 返回值中 stdout/stderr 为完整捕获（有上限）。
   */
  run(tool: ToolName, args: string[], opts?: { timeoutSec?: number; stdin?: string; quiet?: boolean }): Promise<RunResult>;
  /** 登记工作目录中的文件为产物（文件必须已存在），返回 Artifact */
  addArtifact(name: string, kind: Artifact['kind'], label: string): Promise<Artifact>;
  /** 直接写入一个产物文件并登记 */
  writeArtifact(name: string, content: string | Uint8Array, kind: Artifact['kind'], label: string): Promise<Artifact>;
  /** 已登记的产物 */
  readonly artifacts: Artifact[];
}

/** 每种任务一个 flow：成功返回结果；失败时抛出 FlowError（带诊断），或返回带 error 诊断的结果 */
export type Flow<K extends JobRequest['kind'] = JobRequest['kind']> = (
  ctx: JobContext,
  req: Extract<JobRequest, { kind: K }>,
) => Promise<Extract<JobResult, { kind: K }>>;

export class FlowError extends Error {
  constructor(
    message: string,
    public diagnostics: Diagnostic[] = [],
  ) {
    super(message);
  }
}
