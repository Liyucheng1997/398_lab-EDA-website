/**
 * 轻量级 Verilog / SystemVerilog 扫描器：不做完整解析，只找
 *   - 模块（module / macromodule / program / interface）声明及其参数名
 *   - 实例化 "TypeName [#(...)] instName [范围] ("
 *   - $dumpfile("x") 文件名
 *   - 系统任务 / `include 中指向工作目录之外的路径（安全检查）
 * 用于在 iverilog / Yosys 运行前推断顶层模块。
 */
import type { FileRole } from '@webeda/shared';

export interface ModuleDecl {
  name: string;
  file: string;
  role: FileRole;
  kind: 'module' | 'program' | 'interface';
  /** 可被覆盖的参数（header 中的参数和 body 中的 parameter；不含 localparam） */
  params: string[];
  /** 实例化：type 可能不是模块（例如被误判的语句），使用时需与已知模块名取交集 */
  instances: { type: string; name: string }[];
}

export interface PathRef {
  file: string;
  line: number;
  call: string;
  path: string;
}

export interface ScanResult {
  modules: ModuleDecl[];
  /** $dumpfile("…") 中的字符串文件名（按出现顺序去重） */
  dumpfiles: string[];
  /** 源码中是否出现 $dumpfile（包括参数不是字面量的情况） */
  hasDumpfile: boolean;
  /** 字符串字面量形式的文件路径引用（$fopen/$readmemh/$dumpfile/`include 等） */
  pathRefs: PathRef[];
}

/** 去掉 // 与 /* *\/ 注释（替换为空格，保留换行以保持行号），字符串原样保留 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      out += src.slice(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

type TokKind = 'id' | 'str' | 'num' | 'punct' | 'sys';
interface Token {
  k: TokKind;
  v: string;
  line: number;
}

const DIRECTIVES_TO_EOL = new Set([
  'define', 'undef', 'undefineall', 'include', 'timescale', 'ifdef', 'ifndef', 'elsif', 'else', 'endif',
  'default_nettype', 'resetall', 'celldefine', 'endcelldefine', 'unconnected_drive', 'nounconnected_drive',
  'line', 'pragma', 'begin_keywords', 'end_keywords', 'protect', 'endprotect',
]);

function tokenize(text: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '`') {
      const m = /^`([A-Za-z_]\w*)/.exec(text.slice(i, i + 64));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1];
      i += m[0].length;
      if (DIRECTIVES_TO_EOL.has(name)) {
        // 跳到行尾（`define 支持反斜杠续行），`include 的文件名保留为 str 记号以便安全检查
        if (name === 'include') {
          const rest = /^[ \t]*(?:"([^"\n]*)"|<([^>\n]*)>)/.exec(text.slice(i, i + 1024));
          if (rest) toks.push({ k: 'sys', v: '`include', line }, { k: 'str', v: rest[1] ?? rest[2], line });
        }
        while (i < n && text[i] !== '\n') {
          if (text[i] === '\\' && text[i + 1] === '\n' && name === 'define') {
            i += 2;
            line++;
            continue;
          }
          if (text[i] === '\\' && text[i + 1] === '\r' && text[i + 2] === '\n' && name === 'define') {
            i += 3;
            line++;
            continue;
          }
          i++;
        }
      } else if (text[i] === '(') {
        // 宏调用 `FOO(a, b)：跳过整个参数表
        let depth = 0;
        while (i < n) {
          if (text[i] === '\n') line++;
          if (text[i] === '(') depth++;
          else if (text[i] === ')' && --depth === 0) {
            i++;
            break;
          }
          i++;
        }
      }
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && text[j] !== '"' && text[j] !== '\n') {
        if (text[j] === '\\' && j + 1 < n) {
          s += text[j + 1];
          j += 2;
          continue;
        }
        s += text[j++];
      }
      toks.push({ k: 'str', v: s, line });
      i = j + 1;
      continue;
    }
    if (ch === '\\') {
      // 转义标识符：\name 直到空白
      let j = i + 1;
      while (j < n && !/\s/.test(text[j])) j++;
      toks.push({ k: 'id', v: text.slice(i, j), line });
      i = j;
      continue;
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][\w$]*/.exec(text.slice(i, i + 128));
      if (m) {
        toks.push({ k: 'sys', v: m[0], line });
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(text[j])) j++;
      toks.push({ k: 'id', v: text.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9']/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w'.?]/.test(text[j])) j++;
      toks.push({ k: 'num', v: text.slice(i, j), line });
      i = j;
      continue;
    }
    toks.push({ k: 'punct', v: ch, line });
    i++;
  }
  return toks;
}

/** 不可能是模块类型名的关键字（遇到 "kw ident (" 时不当作实例化） */
const KEYWORDS = new Set(
  (
    'always always_comb always_ff always_latch and assert assign assume automatic begin bit buf bufif0 bufif1 byte case casex casez ' +
    'class cmos const constraint cover covergroup deassign default defparam disable do edge else end endcase endclass endfunction ' +
    'endgenerate endinterface endmodule endpackage endprogram endtask enum event export extends extern final for force foreach forever ' +
    'fork function generate genvar if iff import initial inout input int integer interface join join_any join_none local localparam logic ' +
    'longint macromodule modport module nand negedge new nmos nor not notif0 notif1 null or output package packed parameter pmos posedge ' +
    'primitive program property pulldown pullup rcmos real realtime ref reg release repeat return rnmos rpmos rtran rtranif0 rtranif1 ' +
    'scalared sequence shortint shortreal signed small specify specparam static string struct supply0 supply1 table task time tran ' +
    'tranif0 tranif1 tri tri0 tri1 triand trior trireg type typedef union unique unique0 unsigned var vectored virtual void wait wand ' +
    'while wire wor xnor xor priority return break continue'
  ).split(/\s+/),
);

const MODULE_START: Record<string, ModuleDecl['kind']> = { module: 'module', macromodule: 'module', program: 'program', interface: 'interface' };
const MODULE_END = new Set(['endmodule', 'endprogram', 'endinterface']);
const PATH_CALLS = new Set(['$fopen', '$dumpfile', '$readmemh', '$readmemb', '$writememh', '$writememb', '$fdumpfile', '$sdf_annotate', '`include']);

/** 从 i 处的 "(" 跳到配对 ")" 之后，返回新下标 */
function skipBalanced(toks: Token[], i: number, open = '(', close = ')'): number {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.k !== 'punct') continue;
    if (t.v === open) depth++;
    else if (t.v === close && --depth === 0) return j + 1;
  }
  return toks.length;
}

/** 参数表 "a = 1, parameter int b = 2" → 等号前的最后一个标识符 */
function collectParamNames(toks: Token[], start: number, end: number, out: string[]) {
  let depth = 0;
  let lastId: string | undefined;
  let seenEq = false;
  for (let j = start; j < end; j++) {
    const t = toks[j];
    if (t.k === 'punct') {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if (t.v === ')' || t.v === ']' || t.v === '}') depth--;
      else if (depth === 0 && t.v === '=' && !seenEq) {
        if (lastId) out.push(lastId);
        seenEq = true;
      } else if (depth === 0 && t.v === ',') {
        seenEq = false;
        lastId = undefined;
      }
    } else if (t.k === 'id' && depth === 0 && !seenEq) {
      if (t.v === 'localparam') {
        // header 中的 localparam 不可覆盖：跳到下一个逗号
        seenEq = true;
        continue;
      }
      if (!KEYWORDS.has(t.v)) lastId = t.v;
    }
  }
}

export function scanSource(file: string, role: FileRole, src: string): ScanResult {
  const text = stripComments(src);
  const toks = tokenize(text);
  const res: ScanResult = { modules: [], dumpfiles: [], hasDumpfile: false, pathRefs: [] };
  let cur: ModuleDecl | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'sys') {
      if (t.v === '$dumpfile') res.hasDumpfile = true;
      if (PATH_CALLS.has(t.v)) {
        // $call ( "path" …   或  `include "path"
        let j = i + 1;
        if (t.v !== '`include' && toks[j]?.v === '(') j++;
        const s = toks[j];
        if (s?.k === 'str') {
          res.pathRefs.push({ file, line: s.line, call: t.v, path: s.v });
          if (t.v === '$dumpfile' && s.v && !res.dumpfiles.includes(s.v)) res.dumpfiles.push(s.v);
        }
      }
      continue;
    }
    if (t.k !== 'id') continue;
    if (MODULE_START[t.v] && !cur) {
      let j = i + 1;
      while (toks[j]?.k === 'id' && (toks[j].v === 'automatic' || toks[j].v === 'static')) j++;
      const nameTok = toks[j];
      if (nameTok?.k !== 'id') continue;
      cur = { name: nameTok.v, file, role, kind: MODULE_START[t.v], params: [], instances: [] };
      res.modules.push(cur);
      j++;
      // import pkg::*; 位于参数表之前
      while (toks[j]?.v === 'import') {
        while (j < toks.length && toks[j].v !== ';') j++;
        j++;
      }
      if (toks[j]?.v === '#' && toks[j + 1]?.v === '(') {
        const end = skipBalanced(toks, j + 1);
        collectParamNames(toks, j + 2, end - 1, cur.params);
        j = end;
      }
      i = j - 1;
      continue;
    }
    if (!cur) continue;
    if (MODULE_END.has(t.v)) {
      cur = null;
      continue;
    }
    if (t.v === 'parameter') {
      let j = i + 1;
      while (j < toks.length && toks[j].v !== ';') j++;
      collectParamNames(toks, i + 1, j, cur.params);
      i = j;
      continue;
    }
    if (KEYWORDS.has(t.v)) continue;
    // 实例化：Type [#(…) | #N] inst [ [..] ]* (
    let j = i + 1;
    if (toks[j]?.v === '#') {
      if (toks[j + 1]?.v === '(') j = skipBalanced(toks, j + 1);
      else if (toks[j + 1] && (toks[j + 1].k === 'num' || toks[j + 1].k === 'id')) j += 2;
      else continue;
    }
    const inst = toks[j];
    if (inst?.k !== 'id' || KEYWORDS.has(inst.v)) continue;
    j++;
    while (toks[j]?.v === '[') j = skipBalanced(toks, j, '[', ']');
    if (toks[j]?.v !== '(') continue;
    cur.instances.push({ type: t.v, name: inst.v });
    // 跳过端口连接表，继续寻找 ", inst2 (…)" 形式的多实例
    let k = skipBalanced(toks, j);
    while (toks[k]?.v === ',' && toks[k + 1]?.k === 'id') {
      let m = k + 2;
      while (toks[m]?.v === '[') m = skipBalanced(toks, m, '[', ']');
      if (toks[m]?.v !== '(') break;
      cur.instances.push({ type: t.v, name: toks[k + 1].v });
      k = skipBalanced(toks, m);
    }
    i = k - 1;
  }
  return res;
}

export interface ScanInput {
  name: string;
  content: string;
  role?: FileRole;
}

export function scanFiles(files: ScanInput[]): ScanResult {
  const all: ScanResult = { modules: [], dumpfiles: [], hasDumpfile: false, pathRefs: [] };
  for (const f of files) {
    const r = scanSource(f.name, f.role ?? 'design', f.content);
    all.modules.push(...r.modules);
    for (const d of r.dumpfiles) if (!all.dumpfiles.includes(d)) all.dumpfiles.push(d);
    all.hasDumpfile ||= r.hasDumpfile;
    all.pathRefs.push(...r.pathRefs);
  }
  return all;
}

/**
 * 推断顶层：从未被实例化的 module/program（不含 interface）。
 * 若其中有测试平台文件中的模块，只返回这些（测试平台优先）；include 文件中的模块排在最后。
 */
export function findTopCandidates(scan: ScanResult, preferTestbench = true): string[] {
  const declared = new Set(scan.modules.map((m) => m.name));
  const instantiated = new Set<string>();
  for (const m of scan.modules) for (const inst of m.instances) if (declared.has(inst.type) && inst.type !== m.name) instantiated.add(inst.type);
  const seen = new Set<string>();
  const roots = scan.modules.filter((m) => {
    if (m.kind === 'interface' || instantiated.has(m.name) || seen.has(m.name)) return false;
    seen.add(m.name);
    return true;
  });
  if (preferTestbench) {
    const tb = roots.filter((m) => m.role === 'testbench');
    if (tb.length) return tb.map((m) => m.name);
  }
  const rank = (m: ModuleDecl) => (m.role === 'include' ? 1 : 0);
  return [...roots].sort((a, b) => rank(a) - rank(b)).map((m) => m.name);
}

/** 模块参数名（找不到模块时返回 undefined） */
export function moduleParams(scan: ScanResult, module: string): string[] | undefined {
  const m = scan.modules.find((d) => d.name === module);
  return m ? [...new Set(m.params)] : undefined;
}

/** 指向工作目录之外（绝对路径或含 ".."）的路径引用 */
export function unsafePathRefs(scan: ScanResult): PathRef[] {
  return scan.pathRefs.filter((r) => {
    const s = r.path.replace(/\\/g, '/');
    return s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.startsWith('~') || s.split('/').includes('..');
  });
}
