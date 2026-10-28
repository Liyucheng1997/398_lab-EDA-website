import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const YOWASP_CLI = path.join(here, 'yowasp-cli.mjs');

/** 本机原生工具（Icarus Verilog） */
export type NativeTool = 'iverilog' | 'vvp';
/** WebAssembly 工具（YoWASP） */
export type WasmTool = 'yosys' | 'nextpnr-ice40' | 'icepack' | 'icepll' | 'nextpnr-ecp5' | 'ecppack';
export type ToolName = NativeTool | WasmTool;

const WASM_TOOLS = new Set<string>(['yosys', 'nextpnr-ice40', 'icepack', 'icepll', 'nextpnr-ecp5', 'ecppack']);

const exe = process.platform === 'win32' ? '.exe' : '';

let iverilogBinDir: string | null | undefined;

/** 查找 Icarus Verilog 的 bin 目录：IVERILOG_BIN 环境变量 → Chocolatey 安装位置 → 常见路径 → PATH */
export function findIverilogBin(): string | null {
  if (iverilogBinDir !== undefined) return iverilogBinDir;
  const candidates = [
    process.env.IVERILOG_BIN,
    'C:\\ProgramData\\chocolatey\\lib\\iverilog\\tools\\bin',
    'C:\\iverilog\\bin',
    'C:\\Program Files\\iverilog\\bin',
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, `iverilog${exe}`))) return (iverilogBinDir = dir);
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['iverilog'], { encoding: 'utf8' });
  const first = which.status === 0 ? which.stdout.split(/\r?\n/).find(Boolean) : undefined;
  return (iverilogBinDir = first ? path.dirname(first) : null);
}

export function resolveCommand(tool: ToolName): { cmd: string; args: string[] } {
  if (WASM_TOOLS.has(tool)) {
    return { cmd: process.execPath, args: ['--experimental-wasm-exnref', '--no-warnings', YOWASP_CLI, tool] };
  }
  const bin = findIverilogBin();
  if (!bin) throw new Error(`找不到 ${tool}：请安装 Icarus Verilog 或设置 IVERILOG_BIN 环境变量`);
  return { cmd: path.join(bin, `${tool}${exe}`), args: [] };
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  /** 实时输出回调（已按 UTF-8 解码，可能是半行） */
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
  signal?: AbortSignal;
  /** 写入 stdin 的内容 */
  stdin?: string;
  env?: Record<string, string>;
  /** stdout/stderr 各自最多保留多少字节用于返回值（实时回调不受影响） */
  captureLimit?: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
}

/** 运行一个 EDA 工具（原生或 WASM），带超时、取消与输出流 */
export function runTool(tool: ToolName, args: string[], opts: RunOptions): Promise<RunResult> {
  const { cmd, args: pre } = resolveCommand(tool);
  return runProcess(cmd, [...pre, ...args], opts);
}

export function runProcess(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const limit = opts.captureLimit ?? 4 * 1024 * 1024;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, ...opts.env },
    });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut, cancelled, durationMs: Date.now() - started });
    };
    const onAbort = () => {
      cancelled = true;
      killTree(child.pid);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener('abort', onAbort);

    const decoderOut = new TextDecoder();
    const decoderErr = new TextDecoder();
    child.stdout.on('data', (buf: Buffer) => {
      const text = decoderOut.decode(buf, { stream: true });
      if (stdout.length < limit) stdout += text;
      opts.onOutput?.('stdout', text);
    });
    child.stderr.on('data', (buf: Buffer) => {
      const text = decoderErr.decode(buf, { stream: true });
      if (stderr.length < limit) stderr += text;
      opts.onOutput?.('stderr', text);
    });
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
    child.on('error', (err) => {
      stderr += `\n${err.message}\n`;
      opts.onOutput?.('stderr', `${err.message}\n`);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
