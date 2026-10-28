/**
 * Playground 页面的纯数据模型：文件/面板/角色规则、文档 reducer、序列化与签名。
 * 不依赖 DOM / React，便于单元测试。
 */
import type {
  Example,
  FileRole,
  Playground,
  PlaygroundInput,
  PlaygroundSettings,
  SimulateOptions,
  SourceFile,
} from '@webeda/shared';

/** 左 = 测试平台面板，右 = 设计面板 */
export type Pane = 'tb' | 'design';

export interface PgFile {
  /** 仅客户端使用的稳定 id（重命名不变） */
  id: string;
  name: string;
  content: string;
  pane: Pane;
}

export interface PgDoc {
  title: string;
  description: string;
  files: PgFile[];
  settings: PlaygroundSettings;
}

export type Standard = NonNullable<SimulateOptions['standard']>;

export const STANDARDS: { value: Standard; label: string }[] = [
  { value: '2012', label: 'SystemVerilog 2012' },
  { value: '2005', label: 'Verilog 2005' },
  { value: '2001', label: 'Verilog 2001' },
  { value: '1995', label: 'Verilog 1995' },
];

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const FILE_NAME_MAX = 100;
export const MAX_FILES = 64;
export const DEFAULT_TIMEOUT = 30;
export const MAX_TIMEOUT = 120;
export const DEFAULT_TITLE = '未命名 Playground';

export const DEFAULT_SETTINGS: PlaygroundSettings = {
  simulator: 'icarus',
  simulate: { standard: '2012', timeoutSec: DEFAULT_TIMEOUT, autoDump: true },
  openWaveform: true,
  showSchematic: false,
};

/* ───────────────────────── 文件名与角色 ───────────────────────── */

const HDL_RE = /\.(sv|v|vl|verilog)$/i;
const INCLUDE_RE = /\.(svh|vh|h)$/i;
const MEMORY_RE = /\.(hex|mem|dat|bin|coe|mif)$/i;
const ALLOWED_EXT_RE = /\.(sv|v|vl|svh|vh|h|hex|mem|dat|bin|coe|mif|txt)$/i;

export function isHdlName(name: string): boolean {
  return HDL_RE.test(name);
}

/** 与服务端 inferRole 一致的推断（文件未带 role 时使用） */
export function inferRoleFromName(name: string): FileRole {
  const lower = name.toLowerCase();
  const base = lower.split('/').pop() ?? lower;
  if (/\.(pcf|lpf|xdc|cst|sdc)$/.test(lower)) return 'constraint';
  if (INCLUDE_RE.test(lower)) return 'include';
  if (MEMORY_RE.test(lower)) return 'memory';
  if (!HDL_RE.test(lower)) return 'other';
  if (/(^|[_\-.])(tb|test|testbench|bench)([_\-.]|$)/.test(base) || base.startsWith('tb') || base.includes('testbench')) return 'testbench';
  return 'design';
}

/** 文件在某个面板中的角色：HDL 由面板决定，其他按扩展名 */
export function roleFor(name: string, pane: Pane): FileRole {
  if (isHdlName(name)) return pane === 'tb' ? 'testbench' : 'design';
  if (INCLUDE_RE.test(name)) return 'include';
  if (MEMORY_RE.test(name)) return 'memory';
  return 'other';
}

/** 从服务端文件推断所在面板 */
export function paneForSource(f: SourceFile): Pane {
  const role = f.role ?? inferRoleFromName(f.name);
  return role === 'testbench' ? 'tb' : 'design';
}

/** 规范化用户输入的文件名（去空白、反斜杠转斜杠；无扩展名时补默认扩展名） */
export function normalizeFileName(raw: string, defaultExt = '.sv'): string {
  let name = raw.replace(/\\/g, '/').trim().replace(/^\.\//, '');
  const base = name.split('/').pop() ?? name;
  if (name && base && !base.includes('.')) name += defaultExt;
  return name;
}

/**
 * 校验文件名；合法返回 null，否则返回中文错误。
 * 规则与服务端 normalizeFiles 一致，并限制扩展名。
 */
export function validateFileName(name: string, existing: string[], ignore?: string): string | null {
  if (!name) return '文件名不能为空';
  if (name.length > FILE_NAME_MAX) return `文件名不能超过 ${FILE_NAME_MAX} 个字符`;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return '不能使用绝对路径';
  if (name.split('/').some((s) => s === '..' || s === '' || s === '.')) return '文件名不能包含空目录、"." 或 ".."';
  if (!/^[\w\-./ ]+$/.test(name)) return '只能包含字母、数字、下划线、横线、点、空格和斜杠';
  if (name.split('/').length > 2) return '最多只能有一级子目录';
  if (!ALLOWED_EXT_RE.test(name)) return '支持的扩展名：.sv .v .svh .vh .hex .mem .dat .txt 等';
  const lower = name.toLowerCase();
  const ign = ignore?.toLowerCase();
  if (existing.some((n) => n.toLowerCase() === lower && n.toLowerCase() !== ign)) return '已存在同名文件';
  return null;
}

/** 生成不冲突的文件名：base.ext、base1.ext、base2.ext… */
export function uniqueFileName(base: string, ext: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(`${base}${ext}`.toLowerCase())) return `${base}${ext}`;
  for (let i = 1; ; i++) {
    const n = `${base}${i}${ext}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

export function defaultExtFor(standard: SimulateOptions['standard']): string {
  return standard === '2012' || standard === undefined ? '.sv' : '.v';
}

/** 新建文件时的初始内容 */
export function starterContent(name: string, pane: Pane): string {
  if (!isHdlName(name)) return '';
  const base = (name.split('/').pop() ?? name).replace(/\.[^.]+$/, '');
  const mod = /^[A-Za-z_][A-Za-z0-9_$]*$/.test(base) ? base : pane === 'tb' ? 'tb_new' : 'new_module';
  const sv = /\.sv$/i.test(name);
  if (pane === 'tb') {
    return `module ${mod};\n  initial begin\n    $display("hello");\n    $finish;\n  end\nendmodule\n`;
  }
  return sv
    ? `module ${mod} (\n  input  logic clk,\n  output logic q\n);\n\nendmodule\n`
    : `module ${mod} (\n  input  wire clk,\n  output reg  q\n);\n\nendmodule\n`;
}

/* ───────────────────────── 设置 ───────────────────────── */

const STANDARD_VALUES = new Set<string>(STANDARDS.map((s) => s.value));

export function clampTimeout(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT;
  return Math.min(MAX_TIMEOUT, Math.max(1, n));
}

/** 合并缺省设置，容忍服务端或本地存储里缺字段/脏数据 */
export function normalizeSettings(raw: unknown): PlaygroundSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlaygroundSettings>;
  const sim = (s.simulate && typeof s.simulate === 'object' ? s.simulate : {}) as SimulateOptions;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    simulator: 'icarus',
    simulate: {
      standard: STANDARD_VALUES.has(String(sim.standard)) ? sim.standard : '2012',
      top: str(sim.top),
      compileFlags: str(sim.compileFlags),
      runFlags: str(sim.runFlags),
      autoDump: sim.autoDump !== false,
      timeoutSec: sim.timeoutSec === undefined ? DEFAULT_TIMEOUT : clampTimeout(sim.timeoutSec),
    },
    openWaveform: s.openWaveform !== false,
    showSchematic: s.showSchematic === true,
  };
}

/** 发送给服务端的仿真选项：去空白、去空串、限制超时 */
export function cleanSimulateOptions(o: SimulateOptions): SimulateOptions {
  const out: SimulateOptions = { standard: o.standard ?? '2012', autoDump: o.autoDump !== false, timeoutSec: clampTimeout(o.timeoutSec) };
  const top = o.top?.trim();
  const cf = o.compileFlags?.trim();
  const rf = o.runFlags?.trim();
  if (top) out.top = top;
  if (cf) out.compileFlags = cf;
  if (rf) out.runFlags = rf;
  return out;
}

/* ───────────────────────── 文档构造与序列化 ───────────────────────── */

let idSeq = 0;
export function newFileId(): string {
  idSeq += 1;
  return `f${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const TEMPLATE_DESIGN = `// 设计代码写在这里（右侧面板 = design）
module counter #(
  parameter int WIDTH = 4
) (
  input  logic             clk,
  input  logic             rst,
  output logic [WIDTH-1:0] q
);
  always_ff @(posedge clk) begin
    if (rst) q <= '0;
    else     q <= q + 1'b1;
  end
endmodule
`;

export const TEMPLATE_TESTBENCH = `// 测试平台写在这里（左侧面板 = testbench）
module tb;
  logic       clk = 0;
  logic       rst = 1;
  logic [3:0] q;

  counter #(.WIDTH(4)) dut (.clk(clk), .rst(rst), .q(q));

  always #5 clk = ~clk;

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    #12 rst = 0;
    repeat (20) @(posedge clk);
    $display("q = %0d", q);
    $finish;
  end
endmodule
`;

export function templateDoc(): PgDoc {
  return {
    title: DEFAULT_TITLE,
    description: '',
    files: [
      { id: newFileId(), name: 'testbench.sv', content: TEMPLATE_TESTBENCH, pane: 'tb' },
      { id: newFileId(), name: 'design.sv', content: TEMPLATE_DESIGN, pane: 'design' },
    ],
    settings: normalizeSettings(DEFAULT_SETTINGS),
  };
}

function filesFromSources(files: SourceFile[] | undefined, layout?: Record<string, Pane>): PgFile[] {
  return (Array.isArray(files) ? files : [])
    .filter((f) => f && typeof f.name === 'string')
    .map((f) => {
      const pane = !isHdlName(f.name) && layout?.[f.name] ? layout[f.name] : paneForSource(f);
      return { id: newFileId(), name: f.name, content: typeof f.content === 'string' ? f.content : '', pane };
    });
}

export function docFromPlayground(p: Playground, layout?: Record<string, Pane>): PgDoc {
  return {
    title: typeof p.title === 'string' && p.title.trim() ? p.title.slice(0, TITLE_MAX) : DEFAULT_TITLE,
    description: typeof p.description === 'string' ? p.description.slice(0, DESCRIPTION_MAX) : '',
    files: filesFromSources(p.files, layout),
    settings: normalizeSettings(p.settings),
  };
}

export function docFromExample(ex: Example): PgDoc {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, simulate: { ...DEFAULT_SETTINGS.simulate, ...(ex.simulate ?? {}) } });
  return {
    title: (ex.title || DEFAULT_TITLE).slice(0, TITLE_MAX),
    description: (ex.description ?? '').slice(0, DESCRIPTION_MAX),
    files: filesFromSources(ex.files),
    settings,
  };
}

export function toSourceFiles(files: PgFile[]): SourceFile[] {
  return files.map((f) => ({ name: f.name, content: f.content, role: roleFor(f.name, f.pane) }));
}

export function toInput(doc: PgDoc): PlaygroundInput {
  const description = doc.description.trim() ? doc.description.slice(0, DESCRIPTION_MAX) : undefined;
  return {
    title: (doc.title.trim() || DEFAULT_TITLE).slice(0, TITLE_MAX),
    description,
    files: toSourceFiles(doc.files),
    settings: { ...doc.settings, simulate: cleanSimulateOptions(doc.settings.simulate) },
  };
}

/** 非 HDL 文件的面板布局（服务端只存 role，左右面板信息靠它在本地恢复） */
export function layoutOf(doc: PgDoc): Record<string, Pane> {
  const out: Record<string, Pane> = {};
  // 非 HDL 文件从服务端加载时默认进入设计面板，因此只需记录放在左侧的
  for (const f of doc.files) if (!isHdlName(f.name) && f.pane === 'tb') out[f.name] = 'tb';
  return out;
}

/** cyrb53：快速 53 位字符串哈希，用于脏检查 */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 文档内容签名（包含面板布局）：相等即视为未修改 */
export function docSignature(doc: PgDoc): string {
  const input = toInput(doc);
  return hashString(JSON.stringify([input.title, input.description ?? '', input.files.map((f) => [f.name, f.role, f.content]), input.settings, layoutOf(doc)]));
}

/* ───────────────────────── Reducer ───────────────────────── */

export type DocAction =
  | { type: 'load'; doc: PgDoc }
  | { type: 'title'; title: string }
  | { type: 'description'; description: string }
  | { type: 'content'; fileId: string; content: string }
  | { type: 'addFile'; file: PgFile }
  | { type: 'renameFile'; fileId: string; name: string }
  | { type: 'deleteFile'; fileId: string }
  | { type: 'settings'; patch: Partial<Omit<PlaygroundSettings, 'simulate'>> }
  | { type: 'simulate'; patch: Partial<SimulateOptions> };

export function docReducer(doc: PgDoc, a: DocAction): PgDoc {
  switch (a.type) {
    case 'load':
      return a.doc;
    case 'title': {
      const title = a.title.slice(0, TITLE_MAX);
      return title === doc.title ? doc : { ...doc, title };
    }
    case 'description': {
      const description = a.description.slice(0, DESCRIPTION_MAX);
      return description === doc.description ? doc : { ...doc, description };
    }
    case 'content': {
      const f = doc.files.find((x) => x.id === a.fileId);
      if (!f || f.content === a.content) return doc;
      return { ...doc, files: doc.files.map((x) => (x.id === a.fileId ? { ...x, content: a.content } : x)) };
    }
    case 'addFile': {
      if (doc.files.length >= MAX_FILES) return doc;
      if (validateFileName(a.file.name, doc.files.map((f) => f.name))) return doc;
      return { ...doc, files: [...doc.files, a.file] };
    }
    case 'renameFile': {
      const f = doc.files.find((x) => x.id === a.fileId);
      if (!f || f.name === a.name) return doc;
      if (validateFileName(a.name, doc.files.map((x) => x.name), f.name)) return doc;
      return { ...doc, files: doc.files.map((x) => (x.id === a.fileId ? { ...x, name: a.name } : x)) };
    }
    case 'deleteFile': {
      if (!doc.files.some((x) => x.id === a.fileId)) return doc;
      return { ...doc, files: doc.files.filter((x) => x.id !== a.fileId) };
    }
    case 'settings':
      return { ...doc, settings: { ...doc.settings, ...a.patch } };
    case 'simulate':
      return { ...doc, settings: { ...doc.settings, simulate: { ...doc.settings.simulate, ...a.patch } } };
    default:
      return doc;
  }
}

/** 面板中当前应激活的文件 id：优先 wanted，不存在时退回第一个 */
export function resolveActive(files: PgFile[], pane: Pane, wanted: string | null | undefined): string | null {
  const inPane = files.filter((f) => f.pane === pane);
  if (wanted && inPane.some((f) => f.id === wanted)) return wanted;
  return inPane[0]?.id ?? null;
}

/** 删除后应激活的邻居 */
export function neighborAfterDelete(files: PgFile[], fileId: string): string | null {
  const f = files.find((x) => x.id === fileId);
  if (!f) return null;
  const inPane = files.filter((x) => x.pane === f.pane);
  const i = inPane.findIndex((x) => x.id === fileId);
  return inPane[i + 1]?.id ?? inPane[i - 1]?.id ?? null;
}

/** 校验从本地存储读回的文档结构；不合法返回 null */
export function sanitizeDoc(raw: unknown): PgDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<PgDoc>;
  if (!Array.isArray(d.files)) return null;
  const files: PgFile[] = [];
  const seen = new Set<string>();
  for (const f of d.files as Partial<PgFile>[]) {
    if (!f || typeof f.name !== 'string' || typeof f.content !== 'string') return null;
    if (seen.has(f.name.toLowerCase())) return null;
    seen.add(f.name.toLowerCase());
    files.push({ id: typeof f.id === 'string' && f.id ? f.id : newFileId(), name: f.name, content: f.content, pane: f.pane === 'tb' ? 'tb' : 'design' });
  }
  return {
    title: typeof d.title === 'string' ? d.title.slice(0, TITLE_MAX) : DEFAULT_TITLE,
    description: typeof d.description === 'string' ? d.description.slice(0, DESCRIPTION_MAX) : '',
    files,
    settings: normalizeSettings(d.settings),
  };
}

/* ───────────────────────── 错误分类与格式化 ───────────────────────── */

export type ErrorKind = 'notfound' | 'offline' | 'other';

/** 区分 404、服务器不可达（网络错误 / 代理 5xx）与其他错误 */
export function classifyError(e: unknown): ErrorKind {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError || /failed to fetch|networkerror|network error|load failed|fetch failed|ECONNREFUSED/i.test(msg)) return 'offline';
  if (/^404\b/.test(msg) || /不存在/.test(msg)) return 'notfound';
  if (/^(500|502|503|504)\b/.test(msg)) return 'offline';
  return 'other';
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
