/**
 * Studio 纯逻辑：源文件角色、模块解析、任务输入组装、输入摘要哈希。
 * 不依赖 React / DOM，可直接单元测试。
 */
import type { FileRole, Project, ProjectSettings, SourceFile } from '@webeda/shared';
import { getDevice } from '@webeda/shared';

/* ───────────────────────── 文件角色 ───────────────────────── */

/** 与服务端 jobs/files.ts inferRole 保持一致的推断规则 */
export function inferRole(name: string): FileRole {
  const lower = name.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (/\.(pcf|lpf|xdc|cst|sdc)$/.test(lower)) return 'constraint';
  if (/\.(vh|svh|h)$/.test(lower)) return 'include';
  if (/\.(hex|mem|bin|coe|mif)$/.test(lower)) return 'memory';
  if (!/\.(v|sv|vl|verilog)$/.test(lower)) return 'other';
  if (/(^|[_\-.])(tb|test|testbench|bench)([_\-.]|$)/.test(base) || base.startsWith('tb') || base.includes('testbench')) return 'testbench';
  return 'design';
}

export function roleOf(f: SourceFile): FileRole {
  return f.role ?? inferRole(f.name);
}

export function isHdlName(name: string): boolean {
  return /\.(v|sv|vl|verilog)$/i.test(name);
}

export type SourceGroupKey = 'design' | 'constraint' | 'testbench' | 'memory' | 'other';

export interface SourceGroup {
  key: SourceGroupKey;
  label: string;
  /** Vivado 中的英文名，作为副标题 */
  en: string;
  files: SourceFile[];
}

const GROUP_DEFS: { key: SourceGroupKey; label: string; en: string; roles: FileRole[] }[] = [
  { key: 'design', label: '设计源文件', en: 'Design Sources', roles: ['design', 'include'] },
  { key: 'constraint', label: '约束', en: 'Constraints', roles: ['constraint'] },
  { key: 'testbench', label: '仿真源文件', en: 'Simulation Sources', roles: ['testbench'] },
  { key: 'memory', label: '存储器文件', en: 'Memory Files', roles: ['memory'] },
  { key: 'other', label: '其他', en: 'Other', roles: ['other'] },
];

/** 按角色分组（组顺序固定，组内按文件名排序；空组也返回，方便界面统一展示） */
export function groupFiles(files: SourceFile[]): SourceGroup[] {
  return GROUP_DEFS.map(({ key, label, en, roles }) => ({
    key,
    label,
    en,
    files: files.filter((f) => roles.includes(roleOf(f))).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export const ROLE_LABEL: Record<FileRole, string> = {
  design: '设计源文件',
  include: '头文件 (include)',
  constraint: '约束',
  testbench: '仿真源文件',
  memory: '存储器文件',
  other: '其他',
};

/** 默认文件内容（新建文件时） */
export function defaultFileContent(name: string, role: FileRole): string {
  const base = name.slice(name.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  const ident = /^[A-Za-z_]\w*$/.test(base) ? base : 'new_module';
  if (role === 'design' && isHdlName(name)) {
    return `module ${ident} (\n  input  logic clk,\n  input  logic rst,\n  output logic out\n);\n\n  assign out = 1'b0;\n\nendmodule\n`;
  }
  if (role === 'testbench' && isHdlName(name)) {
    return `\`timescale 1ns/1ps\nmodule ${ident};\n  initial begin\n    $dumpfile("dump.vcd");\n    $dumpvars(0, ${ident});\n    #100;\n    $finish;\n  end\nendmodule\n`;
  }
  if (role === 'include') return `// ${name}\n`;
  if (role === 'constraint') return `# ${name}\n`;
  return '';
}

/** 与服务端 normalizeFiles 一致的文件名校验；返回错误消息或 null */
export function validateFileName(raw: string, existing: string[], self?: string): string | null {
  const name = raw.replace(/\\/g, '/').trim();
  if (!name) return '文件名不能为空';
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return '不能使用绝对路径';
  if (name.split('/').some((s) => s === '..' || s === '' || s === '.')) return '文件名不合法';
  if (!/^[\w\-./ ]+$/.test(name)) return '文件名只能包含字母、数字、下划线、横线、点和斜杠';
  if (name.length > 120) return '文件名过长';
  const lower = name.toLowerCase();
  if (existing.some((n) => n.toLowerCase() === lower && n !== self)) return '已存在同名文件';
  return null;
}

export function normalizeFileName(raw: string): string {
  return raw.replace(/\\/g, '/').trim();
}

/* ───────────────────────── 模块解析 ───────────────────────── */

/** 去掉注释和字符串，保留换行（行号不变） */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"') {
      out += '""';
      i++;
      while (i < n && src[i] !== '"' && src[i] !== '\n') {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const MODULE_RE = /\b(?:module|macromodule)\s+(?:automatic\s+|static\s+)?([A-Za-z_][\w$]*)/g;

/** 源码中声明的模块名（按出现顺序） */
export function parseModules(src: string): string[] {
  const clean = stripComments(src);
  const out: string[] = [];
  for (const m of clean.matchAll(MODULE_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

interface ModuleBody {
  name: string;
  file: string;
  body: string;
}

function moduleBodies(files: SourceFile[]): ModuleBody[] {
  const out: ModuleBody[] = [];
  for (const f of files) {
    if (!isHdlName(f.name)) continue;
    const clean = stripComments(f.content);
    const re = /\b(?:module|macromodule)\s+(?:automatic\s+|static\s+)?([A-Za-z_][\w$]*)([\s\S]*?)\bendmodule\b/g;
    for (const m of clean.matchAll(re)) out.push({ name: m[1], file: f.name, body: m[2] });
  }
  return out;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 一组文件内被其它模块实例化的模块名集合 */
function instantiated(bodies: ModuleBody[]): Set<string> {
  const used = new Set<string>();
  for (const m of bodies) {
    const re = new RegExp(`(^|[^\\w$.])${escapeRe(m.name)}\\s*(#\\s*\\(|[A-Za-z_][\\w$]*\\s*(\\[[^\\]]*\\]\\s*)?\\()`);
    if (bodies.some((o) => o.name !== m.name && re.test(o.body))) used.add(m.name);
  }
  return used;
}

/** 文件 → 其中声明的模块 */
export function modulesByFile(files: SourceFile[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of files) if (isHdlName(f.name)) map.set(f.name, parseModules(f.content));
  return map;
}

/** 给定角色的全部模块与"顶层候选"（未被实例化的模块） */
export function moduleInfo(files: SourceFile[], roles: FileRole[]): { all: string[]; tops: string[] } {
  const sel = files.filter((f) => roles.includes(roleOf(f)));
  const bodies = moduleBodies(sel);
  const all: string[] = [];
  for (const b of bodies) if (!all.includes(b.name)) all.push(b.name);
  const used = instantiated(bodies);
  return { all, tops: all.filter((m) => !used.has(m)) };
}

/** 找到声明某模块的文件 */
export function fileOfModule(files: SourceFile[], module: string | undefined): string | undefined {
  if (!module) return undefined;
  for (const f of files) if (isHdlName(f.name) && parseModules(f.content).includes(module)) return f.name;
  return undefined;
}

/* ───────────────────────── 任务输入 ───────────────────────── */

export type FlowKind = 'simulate' | 'elaborate' | 'synthesize' | 'implement' | 'gatesim';

/** 某类任务需要上传的文件（显式带上 role，避免服务端推断不一致） */
export function filesForKind(files: SourceFile[], kind: FlowKind | 'yosys', constraintFile?: string): SourceFile[] {
  const withRole = files.map((f) => ({ ...f, role: roleOf(f) }));
  const base = withRole.filter((f) => f.role === 'design' || f.role === 'include' || f.role === 'memory');
  if (kind === 'simulate') return withRole.filter((f) => f.role !== 'constraint' && f.role !== 'other');
  if (kind === 'implement') {
    const c = constraintFile ? withRole.find((f) => f.name === constraintFile) : undefined;
    return c ? [...base, c] : base;
  }
  return base;
}

/** 设计源文件中的 HDL 文件名（Tcl Console 的 read_verilog 用） */
export function designHdlFiles(files: SourceFile[]): string[] {
  return files.filter((f) => roleOf(f) === 'design' && isHdlName(f.name)).map((f) => f.name);
}

/** Tcl Console 的 Yosys 脚本 */
export function consoleScript(files: SourceFile[], top: string | undefined, command: string, raw: boolean): string {
  if (raw) return command;
  const hdl = designHdlFiles(files);
  const quote = (n: string) => (/\s/.test(n) ? `"${n}"` : n);
  const lines: string[] = [];
  if (hdl.length) lines.push(`read_verilog -sv ${hdl.map(quote).join(' ')}`);
  lines.push(top ? `hierarchy -check -top ${top}` : 'hierarchy -auto-top');
  if (command.trim()) lines.push(command);
  return lines.join('\n');
}

/** 32 位 FNV-1a 哈希（十六进制） */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 某类任务的输入摘要：文件或相关设置变化后与上次运行不同，即"已过期" */
export function inputHash(kind: FlowKind, project: Pick<Project, 'files'> & { settings: ProjectSettings }): string {
  const s = project.settings;
  const files = filesForKind(project.files, kind, s.constraintFile)
    .map((f) => `${f.name}\u0000${f.role}\u0000${f.content}`)
    .sort();
  let opts: unknown;
  switch (kind) {
    case 'simulate':
      opts = [s.simTop ?? '', s.simulate];
      break;
    case 'elaborate':
      opts = [s.top ?? ''];
      break;
    case 'synthesize':
      opts = [s.top ?? '', s.device, s.synth?.flatten ?? true];
      break;
    case 'implement':
      opts = [s.top ?? '', s.device, s.constraintFile ?? '', s.freqMHz];
      break;
    case 'gatesim':
      opts = [s.top ?? '', s.gatesimParams ?? {}];
      break;
  }
  return fnv1a(JSON.stringify([kind, files, opts]));
}

/** 器件对应的综合目标 */
export function synthTarget(device: string): 'ice40' | 'ecp5' | 'xc7' | 'gowin' {
  return getDevice(device)?.family ?? 'ice40';
}

/** 工程中所有约束文件（优先与器件扩展名匹配的） */
export function constraintFiles(files: SourceFile[], device?: string): string[] {
  const ext = getDevice(device)?.constraintExt;
  const list = files.filter((f) => roleOf(f) === 'constraint').map((f) => f.name);
  const miss = (n: string) => Number(!!ext && !n.toLowerCase().endsWith(ext));
  return list.sort((a, b) => miss(a) - miss(b) || a.localeCompare(b));
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\-_]/g;

/** 去掉终端颜色等 ANSI 转义序列（Yosys 日志带颜色） */
export function stripAnsi(text: string): string {
  return text.includes('\u001b') ? text.replace(ANSI_RE, '') : text;
}
