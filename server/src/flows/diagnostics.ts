/**
 * 各工具输出 → Diagnostic 的解析器（纯函数，便于单元测试）。
 */
import type { Diagnostic, Severity, SourceFile } from '@webeda/shared';

/** 去掉 ANSI 颜色控制序列（YoWASP Yosys 会输出彩色日志） */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[@-Z\\-_]/g, '');
}

function splitLines(text: string): string[] {
  return stripAnsi(text).split(/\r?\n/);
}

/**
 * 把工具输出里的文件路径映射回 SourceFile.name：
 * 统一斜杠、去掉引号、"./" 前缀与工作目录前缀；对不上任何源文件时返回 undefined。
 */
export class PathMapper {
  private exact = new Map<string, string>();
  private lower = new Map<string, string>();
  private base = new Map<string, string | null>();
  private wd: string;

  constructor(files: Pick<SourceFile, 'name'>[], workDir = '') {
    for (const f of files) {
      this.exact.set(f.name, f.name);
      this.lower.set(f.name.toLowerCase(), f.name);
      const b = f.name.split('/').pop()!.toLowerCase();
      this.base.set(b, this.base.has(b) ? null : f.name);
    }
    this.wd = workDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  /** 返回规范化后的相对路径（不保证存在） */
  normalize(raw: string): string {
    let p = raw.trim().replace(/^["'`]|["'`]$/g, '').replace(/\\/g, '/');
    if (this.wd && p.toLowerCase().startsWith(this.wd + '/')) p = p.slice(this.wd.length + 1);
    while (p.startsWith('./')) p = p.slice(2);
    p = p.replace(/\/\.\//g, '/');
    return p;
  }

  map(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const p = this.normalize(raw);
    const hit = this.exact.get(p) ?? this.lower.get(p.toLowerCase());
    if (hit) return hit;
    // WASM 工具的工作目录是虚拟根 "/"
    if (p.startsWith('/') && !p.startsWith('/share/')) {
      const q = p.replace(/^\/+/, '');
      const h = this.exact.get(q) ?? this.lower.get(q.toLowerCase());
      if (h) return h;
    }
    if (p.includes('/') && !p.startsWith('/share/')) {
      const b = this.base.get(p.split('/').pop()!.toLowerCase());
      if (b) return b;
    }
    return undefined;
  }
}

function diag(tool: string, severity: Severity, message: string, file?: string, line?: number, column?: number): Diagnostic {
  const d: Diagnostic = { severity, message: message.trim(), tool };
  if (file) d.file = file;
  if (file && line !== undefined && Number.isFinite(line) && line > 0) d.line = line;
  if (file && column !== undefined && Number.isFinite(column) && column > 0) d.column = column;
  return d;
}

/* ───────────────────────── Icarus Verilog ───────────────────────── */

/**
 * 解析 iverilog 编译输出。
 * @param failed 编译是否失败（决定 "sorry:" 的严重级别）
 * @param ignoreFiles 这些文件（如自动生成的 _webeda_dump.v）上的诊断直接丢弃
 */
export function parseIverilogOutput(text: string, mapper: PathMapper, failed: boolean, ignoreFiles: string[] = []): Diagnostic[] {
  const out: Diagnostic[] = [];
  const ignore = new Set(ignoreFiles.map((f) => f.toLowerCase()));
  for (const raw of splitLines(text)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = /^(.+?):(\d+):\s*(.*)$/.exec(line);
    if (m && !/^\s/.test(m[1])) {
      const rawFile = mapper.normalize(m[1]);
      if (ignore.has(rawFile.toLowerCase())) continue;
      const file = mapper.map(m[1]);
      const lineNo = Number(m[2]);
      let rest = m[3];
      let severity: Severity;
      const kw = /^(error|warning|sorry|internal error)\s*:\s*(.*)$/i.exec(rest);
      if (kw) {
        const k = kw[1].toLowerCase();
        severity = k === 'warning' ? 'warning' : k === 'sorry' ? (failed ? 'error' : 'warning') : 'error';
        rest = kw[2];
      } else if (/^:\s*/.test(rest)) {
        // "design.sv:1:      : It was declared here as a variable." —— 附注
        severity = 'info';
        rest = rest.replace(/^:\s*/, '');
      } else {
        // "design.sv:3: syntax error"、"x.sv:5: Include file foo.vh not found"
        severity = 'error';
      }
      if (!rest) continue;
      out.push(diag('iverilog', severity, rest, file ?? undefined, file ? lineNo : undefined));
      if (!file) out[out.length - 1].message = `${rawFile}:${lineNo}: ${out[out.length - 1].message}`;
      continue;
    }
    const t = line.trim();
    let g: RegExpExecArray | null;
    if ((g = /^(error|warning|sorry)\s*:\s*(.*)$/i.exec(t))) {
      const k = g[1].toLowerCase();
      out.push(diag('iverilog', k === 'warning' ? 'warning' : k === 'sorry' && !failed ? 'warning' : 'error', g[2]));
    } else if (/^I give up\.?$/i.test(t)) {
      out.push(diag('iverilog', 'error', 'I give up.（错误过多，编译器放弃，请先修正上面的错误）'));
    } else if (/^No top level modules/i.test(t)) {
      out.push(diag('iverilog', 'error', t));
    } else if (/^(Unable to open|Unknown option|.*: No such file or directory)/i.test(t)) {
      out.push(diag('iverilog', 'error', t));
    }
  }
  return out;
}

/** 解析 vvp 运行输出：$error/$warning/$fatal/$info、VCD 警告、运行时错误 */
export function parseVvpOutput(text: string, mapper: PathMapper): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^(ERROR|WARNING|FATAL|INFO):\s*(.+?):(\d+):\s*(.*)$/.exec(line))) {
      const k = m[1];
      const severity: Severity = k === 'WARNING' ? 'warning' : k === 'INFO' ? 'info' : 'error';
      const file = mapper.map(m[2]);
      let msg = m[4] || (k === 'FATAL' ? '$fatal' : k === 'ERROR' ? '$error' : k === 'WARNING' ? '$warning' : '$info');
      if (k === 'FATAL') msg = `致命错误：${msg}`;
      if (!file) msg = `${mapper.normalize(m[2])}:${m[3]}: ${msg}`;
      out.push(diag('vvp', severity, msg, file, file ? Number(m[3]) : undefined));
    } else if ((m = /^VCD (warning|error|Error):\s*(.*)$/.exec(line))) {
      out.push(diag('vvp', m[1].toLowerCase() === 'warning' ? 'warning' : 'error', `VCD：${m[2]}`));
    } else if ((m = /^(.+?):\s*Unable to open input file\.?$/i.exec(line))) {
      out.push(diag('vvp', 'error', line));
    } else if (/^(Segmentation fault|Abort|internal error|vvp: )/i.test(line) || /assertion .* failed/i.test(line)) {
      out.push(diag('vvp', 'error', line));
    }
  }
  return out;
}

/* ───────────────────────── Yosys ───────────────────────── */

const SRC_REF = /([\w./\\ -]*?[\w-]+\.(?:sv|v|vh|svh|vl|verilog|vhd|vhdl|pcf|lpf)):(\d+)(?:\.(\d+))?/i;

/** 从消息里找第一个指向用户源文件的位置引用 */
function findSourceRef(msg: string, mapper: PathMapper): { file: string; line: number; column?: number } | undefined {
  const re = new RegExp(SRC_REF.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    const file = mapper.map(m[1].trim());
    if (file) return { file, line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined };
  }
  return undefined;
}

export function parseYosysOutput(text: string, mapper: PathMapper): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (!line) continue;
    // "design.sv:12: ERROR: syntax error"、"ERROR: Module `\foo' ..."
    const m = /^(?:(.+?):(\d+)(?:\.(\d+))?(?:-\d+(?:\.\d+)?)?:\s*)?(ERROR|Warning|WARNING)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const severity: Severity = m[4] === 'ERROR' ? 'error' : 'warning';
    const msg = m[5];
    if (!msg) continue;
    let file = m[1] ? mapper.map(m[1]) : undefined;
    let lineNo = m[2] ? Number(m[2]) : undefined;
    let col = m[3] ? Number(m[3]) : undefined;
    if (!file) {
      const ref = findSourceRef(msg, mapper);
      if (ref) {
        file = ref.file;
        lineNo = ref.line;
        col = ref.column;
      }
    }
    const prefix = m[1] && !file ? `${mapper.normalize(m[1])}:${m[2]}: ` : '';
    out.push(diag('yosys', severity, prefix + msg, file, lineNo, col));
  }
  return out;
}

/* ───────────────────────── nextpnr / icepack / ecppack ───────────────────────── */

export function parseNextpnrOutput(text: string, mapper: PathMapper): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    const m = /^(ERROR|Error|Warning|WARNING)\s*:\s*(.*)$/.exec(line);
    if (!m || !m[2]) continue;
    const severity: Severity = /^err/i.test(m[1]) ? 'error' : 'warning';
    const ref = findSourceRef(m[2], mapper);
    out.push(diag('nextpnr', severity, m[2], ref?.file, ref?.line, ref?.column));
  }
  return out;
}

export function parsePackerOutput(tool: 'icepack' | 'ecppack', text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    const m = /^(?:\w+:\s*)?(ERROR|Error|error|Warning|WARNING|warning)\s*:\s*(.*)$/.exec(line);
    if (m && m[2]) out.push(diag(tool, /^err/i.test(m[1]) ? 'error' : 'warning', m[2]));
    else if (/^terminate called|what\(\):/.test(line)) out.push(diag(tool, 'error', line));
  }
  return out;
}

/* ───────────────────────── 汇总 ───────────────────────── */

/** 去重并限制条数（同一条消息只保留一次；超出上限时追加一条 info） */
export function finalizeDiagnostics(list: Diagnostic[], max = 300): Diagnostic[] {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  let dropped = 0;
  for (const d of list) {
    const key = `${d.severity}|${d.tool}|${d.file ?? ''}|${d.line ?? ''}|${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 错误优先保留（最多 2×max），其余超过 max 后丢弃
    if ((out.length >= max && d.severity !== 'error') || out.length >= max * 2) {
      dropped++;
      continue;
    }
    out.push(d);
  }
  if (dropped) out.push({ severity: 'info', tool: 'webeda', message: `还有 ${dropped} 条诊断未显示，请查看完整日志` });
  return out;
}

export function hasError(list: Diagnostic[]): boolean {
  return list.some((d) => d.severity === 'error');
}
