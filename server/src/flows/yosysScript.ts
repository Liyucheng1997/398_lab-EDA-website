/**
 * Yosys 控制台脚本的安全检查：禁止 shell 转义与工作目录之外的路径。
 * （YoWASP 在 WebAssembly 沙箱中运行，本身无法访问宿主文件系统；这里是第二道防线，并给出清楚的错误提示。）
 */
import { tokenize } from './flags';

export interface ScriptProblem {
  line: number;
  message: string;
}

/** 可以执行宿主命令或加载原生代码的命令 */
const BLOCKED = new Set(['shell', 'exec', 'tcl', 'python', 'plugin', 'pyosys']);

/** 把脚本拆成命令：去掉 # 注释（引号外），按 ; 分隔（引号外） */
export function splitYosysScript(script: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  script.split(/\r?\n/).forEach((raw, idx) => {
    let cur = '';
    let quote = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '"') quote = !quote;
      if (!quote && ch === '#') break;
      if (!quote && ch === ';') {
        if (cur.trim()) out.push({ line: idx + 1, text: cur.trim() });
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push({ line: idx + 1, text: cur.trim() });
  });
  return out;
}

function escapesWorkDir(token: string): boolean {
  const s = token.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.startsWith('~')) return true;
  return s.split('/').some((seg) => seg === '..');
}

export function checkYosysScript(script: string): ScriptProblem[] {
  const problems: ScriptProblem[] = [];
  for (const cmd of splitYosysScript(script)) {
    if (cmd.text.startsWith('!')) {
      problems.push({ line: cmd.line, message: '不允许使用 "!" 执行 shell 命令' });
      continue;
    }
    const { tokens, error } = tokenize(cmd.text);
    if (error) {
      problems.push({ line: cmd.line, message: error });
      continue;
    }
    if (!tokens.length) continue;
    const name = tokens[0];
    if (BLOCKED.has(name)) {
      problems.push({ line: cmd.line, message: `出于安全原因，不允许使用 ${name} 命令` });
      continue;
    }
    for (const t of tokens.slice(1)) {
      // "-o/abs" 形式的粘连参数也要检查
      const val = /^-[A-Za-z]\//.test(t) ? t.slice(2) : t;
      if (escapesWorkDir(val)) {
        problems.push({ line: cmd.line, message: `${name}：路径 "${t}" 指向工作目录之外，只能使用相对路径` });
        break;
      }
    }
  }
  return problems;
}
