/**
 * Yosys `write_json` 输出格式（只声明 flow 用到的字段）以及常用的小工具函数。
 */

/** 位：整数为线网编号（≥2），字符串为常量 */
export type YosysBit = number | '0' | '1' | 'x' | 'z';

export type YosysAttrValue = string | number;

export interface YosysPort {
  direction: 'input' | 'output' | 'inout';
  bits: YosysBit[];
  offset?: number;
  upto?: number;
  signed?: number;
}

export interface YosysCell {
  hide_name?: number;
  type: string;
  parameters?: Record<string, YosysAttrValue>;
  attributes?: Record<string, YosysAttrValue>;
  port_directions?: Record<string, 'input' | 'output' | 'inout'>;
  connections: Record<string, YosysBit[]>;
}

export interface YosysNetname {
  hide_name?: number;
  bits: YosysBit[];
  offset?: number;
  upto?: number;
  signed?: number;
  attributes?: Record<string, YosysAttrValue>;
}

export interface YosysModule {
  attributes?: Record<string, YosysAttrValue>;
  parameter_default_values?: Record<string, YosysAttrValue>;
  ports?: Record<string, YosysPort>;
  cells?: Record<string, YosysCell>;
  netnames?: Record<string, YosysNetname>;
  memories?: Record<string, unknown>;
}

export interface YosysDesign {
  creator?: string;
  modules: Record<string, YosysModule>;
}

/** Yosys 把整数属性写成二进制字符串（"00000000000000000000000000000001"） */
export function attrTrue(v: YosysAttrValue | undefined): boolean {
  if (v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  const s = v.trim();
  if (/^[01xz]+$/i.test(s)) return s.includes('1');
  return s.length > 0;
}

/** 二进制字符串属性 → 整数（失败返回 undefined） */
export function attrInt(v: YosysAttrValue | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (/^[01]+$/.test(v)) return parseInt(v.slice(-52), 2);
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function attrString(v: YosysAttrValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? String(v) : v.replace(/ $/, '');
}

export function isBlackbox(m: YosysModule | undefined): boolean {
  if (!m) return false;
  return attrTrue(m.attributes?.blackbox);
}

/** 设计中真正的用户模块（排除单元库黑盒与 Yosys 内部辅助模块） */
export function designModules(design: YosysDesign): string[] {
  return Object.keys(design.modules).filter((name) => {
    if (isBlackbox(design.modules[name])) return false;
    if (name.startsWith('$__')) return false;
    return true;
  });
}

/** 找顶层：带 top 属性的非黑盒模块；否则用提示名；否则唯一的未被实例化的模块 */
export function findTopModule(design: YosysDesign, hint?: string): string | undefined {
  const mods = designModules(design);
  const flagged = mods.find((n) => attrTrue(design.modules[n].attributes?.top));
  if (flagged) return flagged;
  if (hint && design.modules[hint]) return hint;
  const instantiated = new Set<string>();
  for (const n of mods) for (const c of Object.values(design.modules[n].cells ?? {})) instantiated.add(c.type);
  const roots = mods.filter((n) => !instantiated.has(n));
  return roots.length >= 1 ? roots[0] : mods[0];
}

/** 用户可见的单元（$scopeinfo 只是层次元数据） */
export function isRealCell(c: YosysCell): boolean {
  return c.type !== '$scopeinfo';
}

export function countRealCells(m: YosysModule): number {
  let n = 0;
  for (const c of Object.values(m.cells ?? {})) if (isRealCell(c)) n++;
  return n;
}

/**
 * Yosys 派生模块名的可读形式：
 *   $paramod\counter\W=s32'00000000000000000000000000001000  →  counter(W=8)
 *   $paramod$3f2a…\counter                                        →  counter$3f2a
 */
export function prettyModuleName(raw: string): string {
  let name = raw.startsWith('\\') ? raw.slice(1) : raw;
  if (!name.startsWith('$paramod')) return name;
  const parts = name.split('\\');
  if (parts.length < 2) return name;
  const head = parts[0];
  const base = parts[1];
  const params = parts.slice(2).filter(Boolean);
  if (head !== '$paramod') {
    const hash = head.slice('$paramod$'.length, '$paramod$'.length + 6);
    return hash ? `${base}$${hash}` : base;
  }
  if (!params.length) return base;
  const pretty = params.map((p) => {
    const eq = p.indexOf('=');
    if (eq < 0) return p;
    return `${p.slice(0, eq)}=${prettyConst(p.slice(eq + 1))}`;
  });
  name = `${base}(${pretty.join(', ')})`;
  return name;
}

function prettyConst(v: string): string {
  const m = /^([su]?)(\d+)'([01xz]+)$/i.exec(v);
  if (!m) return v;
  const bits = m[3];
  if (/[xz]/i.test(bits)) return `${m[2]}'b${bits}`;
  let value = BigInt('0b' + bits);
  if (m[1] === 's' && bits.length > 0 && bits[0] === '1') value -= 1n << BigInt(bits.length);
  return value.toString();
}

/** 把任意模块名变成安全的产物文件名片段 */
export function safeFileStem(name: string): string {
  const s = name.replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').replace(/_+$/, '');
  return (s || 'module').slice(0, 80);
}
