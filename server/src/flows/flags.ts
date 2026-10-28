/**
 * 用户提供的命令行参数：安全分词 + 白名单校验。
 * 工具通过 argv 直接启动（不经过 shell），这里的校验防止用户借参数读写工作目录之外的文件或加载 VPI 模块。
 */

export interface FlagResult {
  args: string[];
  errors: string[];
  /** 编译参数中的 -s 顶层 */
  tops: string[];
}

/** 类 shell 分词：空白分隔，支持 '…' 与 "…"（双引号内可用 \" 转义） */
export function tokenize(input: string): { tokens: string[]; error?: string } {
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (quote === '"' && ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        cur += input[++i];
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) return { tokens, error: `引号未闭合：${quote}` };
  if (has) tokens.push(cur);
  return { tokens };
}

const IDENT = /^[A-Za-z_][\w$]*$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;

/** 工作目录内的相对路径：不允许绝对路径、盘符、".." 段 */
export function isSafeRelativePath(p: string): boolean {
  if (!p || CONTROL.test(p)) return false;
  const s = p.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.startsWith('~')) return false;
  return !s.split('/').some((seg) => seg === '..');
}

const COMPILE_HELP = '允许的编译参数：-D<宏>[=值] -P<顶层.参数>=<值> -W<警告类> -g<语言特性> -I<相对目录> -y<相对目录> -Y<后缀> -s <模块> -p<键>=<值> -T<min|typ|max> -v';

/** 校验 iverilog 额外编译参数 */
export function parseCompileFlags(input: string | undefined): FlagResult {
  const res: FlagResult = { args: [], errors: [], tops: [] };
  if (!input || !input.trim()) return res;
  if (input.length > 4000) {
    res.errors.push('编译参数过长');
    return res;
  }
  const { tokens, error } = tokenize(input);
  if (error) {
    res.errors.push(error);
    return res;
  }
  const needValue = (flag: string, i: number): string | undefined => {
    const v = tokens[i + 1];
    if (v === undefined || v.startsWith('-')) {
      res.errors.push(`参数 ${flag} 缺少取值`);
      return undefined;
    }
    return v;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (CONTROL.test(t)) {
      res.errors.push('参数中不能包含控制字符');
      continue;
    }
    let m: RegExpExecArray | null;
    if (t === '-D') {
      const v = needValue(t, i);
      if (v === undefined) continue;
      i++;
      if (/^[A-Za-z_][\w$]*(=.*)?$/.test(v)) res.args.push(`-D${v}`);
      else res.errors.push(`宏定义格式错误：-D ${v}`);
    } else if ((m = /^-D(.+)$/.exec(t))) {
      if (/^[A-Za-z_][\w$]*(=.*)?$/.test(m[1])) res.args.push(t);
      else res.errors.push(`宏定义格式错误：${t}`);
    } else if ((m = /^-P(.*)$/.exec(t))) {
      if (/^[A-Za-z_][\w$]*\.[A-Za-z_][\w$]*=.+$/.test(m[1])) res.args.push(t);
      else res.errors.push(`参数覆盖格式应为 -P<顶层模块>.<参数>=<值>：${t}`);
    } else if (/^-W[\w-]+$/.test(t)) {
      res.args.push(t);
    } else if (/^-g[\w-]+$/.test(t)) {
      res.args.push(t);
    } else if ((m = /^-([Iy])(.*)$/.exec(t))) {
      let dir = m[2];
      if (!dir) {
        const v = needValue(t, i);
        if (v === undefined) continue;
        dir = v;
        i++;
      }
      if (isSafeRelativePath(dir)) res.args.push(`-${m[1]}${dir}`);
      else res.errors.push(`${t[1] === 'I' ? '头文件' : '库'}目录必须是工作目录内的相对路径：${dir}`);
    } else if ((m = /^-Y(.*)$/.exec(t))) {
      let suf = m[1];
      if (!suf) {
        const v = needValue(t, i);
        if (v === undefined) continue;
        suf = v;
        i++;
      }
      if (/^\.?[\w.]+$/.test(suf)) res.args.push(`-Y${suf}`);
      else res.errors.push(`库文件后缀格式错误：${suf}`);
    } else if ((m = /^-s(.*)$/.exec(t))) {
      let name = m[1];
      if (!name) {
        const v = needValue(t, i);
        if (v === undefined) continue;
        name = v;
        i++;
      }
      if (IDENT.test(name)) {
        res.args.push('-s', name);
        res.tops.push(name);
      } else res.errors.push(`顶层模块名不合法：${name}`);
    } else if (/^-p[\w-]+=[\w.-]*$/.test(t)) {
      res.args.push(t);
    } else if (/^-T(min|typ|max)$/.test(t)) {
      res.args.push(t);
    } else if (t === '-v') {
      res.args.push(t);
    } else {
      res.errors.push(`不支持的编译参数 "${t}"。${COMPILE_HELP}`);
    }
  }
  return res;
}

/** 校验 vvp 运行参数：只允许 plusargs（+NAME 或 +NAME=VALUE） */
export function parseRunFlags(input: string | undefined): FlagResult {
  const res: FlagResult = { args: [], errors: [], tops: [] };
  if (!input || !input.trim()) return res;
  if (input.length > 4000) {
    res.errors.push('运行参数过长');
    return res;
  }
  const { tokens, error } = tokenize(input);
  if (error) {
    res.errors.push(error);
    return res;
  }
  for (const t of tokens) {
    // 直接作为 argv 传给 vvp（不经过 shell），值中允许空格
    if (/^\+.{1,512}$/.test(t) && !CONTROL.test(t)) res.args.push(t);
    else res.errors.push(`运行参数只支持 plusargs（如 +SEED=1、+verbose）：${t}`);
  }
  return res;
}
