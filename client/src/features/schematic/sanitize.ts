// netlistsvg 产出的 SVG 中含有用户可控的名字（模块、端口、实例），注入页面前必须清洗。
// 策略：元素白名单（按命名空间 + 本地名）、属性黑名单（事件、外部链接、外部 url() 引用）。
// 只依赖 DOM 的最小子集（见 SanitizeElement），便于在无 DOM 的测试环境里用假节点验证。

export const SVG_NS = 'http://www.w3.org/2000/svg';
/** netlistsvg 的元数据命名空间（s:alias、s:properties 等），不参与渲染，保留 */
export const NETLISTSVG_NS = 'https://github.com/nturley/netlistsvg';

/** 允许保留的 SVG 元素（本地名，小写比较） */
const ALLOWED_SVG = new Set(
  [
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'title', 'desc', 'defs', 'use', 'symbol', 'marker',
    'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop', 'metadata',
  ].map((s) => s.toLowerCase()),
);

/** 清洗器用到的最小元素接口（浏览器 Element 天然满足） */
export interface SanitizeElement {
  readonly localName: string;
  readonly namespaceURI: string | null;
  readonly attributes: ArrayLike<{ readonly name: string; readonly value: string }>;
  readonly children: ArrayLike<SanitizeElement>;
  removeAttribute(name: string): void;
  remove(): void;
}

export interface SanitizeReport {
  removedElements: number;
  removedAttributes: number;
}

const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'data']);

/** 值里引用了非本文档片段（url(#id) 之外）的 url(...) */
const URL_FN_RE = /url\s*\(\s*['"]?\s*([^)'"\s]?)/gi;

function hasExternalUrl(v: string): boolean {
  for (const m of v.matchAll(URL_FN_RE)) if (m[1] !== '#') return true;
  return false;
}
const SCRIPT_SCHEME_RE = /^\s*(javascript|vbscript|data)\s*:/i;
const DANGEROUS_STYLE_RE = /(expression\s*\(|@import|behaviou?r\s*:|-moz-binding|javascript\s*:)/i;

/** 去掉控制字符与空白后判断协议，防止 "java\tscript:" 之类绕过 */
function normalizeUrl(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000- \u007f-\u009f]+/g, '');
}

/** 判断元素是否保留 */
export function isAllowedElement(namespaceURI: string | null, localName: string): boolean {
  if (namespaceURI === NETLISTSVG_NS) return true;
  if (namespaceURI !== SVG_NS) return false;
  return ALLOWED_SVG.has(localName.toLowerCase());
}

/** 判断属性是否保留（name 为限定名，如 "xlink:href"、"s:type"） */
export function isAllowedAttribute(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return false; // onclick / onload / onbegin …
  if (n === 'xml:base' || n.startsWith('xmlns:xml')) return false;
  const local = n.includes(':') && n !== 'xlink:href' ? n.slice(n.indexOf(':') + 1) : n;
  if (URL_ATTRS.has(n) || URL_ATTRS.has(local)) {
    // 只允许文档内片段引用（<use href="#id">）
    return normalizeUrl(value).startsWith('#');
  }
  const compact = normalizeUrl(value);
  if (SCRIPT_SCHEME_RE.test(compact)) return false;
  if (/javascript:/i.test(compact)) return false;
  if (hasExternalUrl(value)) return false;
  if (n === 'style' && DANGEROUS_STYLE_RE.test(value)) return false;
  return true;
}

/**
 * 原地清洗一棵元素树：删除不允许的元素（连同子树）与危险属性。
 * 根元素本身不允许时也会被移除（调用方应先检查根是不是 <svg>）。
 */
export function sanitizeTree(root: SanitizeElement): SanitizeReport {
  const report: SanitizeReport = { removedElements: 0, removedAttributes: 0 };
  // 显式栈，避免超深嵌套时递归爆栈
  const stack: SanitizeElement[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    if (!isAllowedElement(el.namespaceURI, el.localName)) {
      el.remove();
      report.removedElements++;
      continue;
    }
    const attrs = el.attributes;
    // 先收集再删除：attributes 是活集合
    const drop: string[] = [];
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      if (!isAllowedAttribute(a.name, a.value)) drop.push(a.name);
    }
    for (const name of drop) el.removeAttribute(name);
    report.removedAttributes += drop.length;
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return report;
}

export interface ParsedSvg {
  /** 已清洗、属于传入 document 的 <svg> 元素（尚未挂到页面） */
  svg: SVGSVGElement;
  /** 内容尺寸（SVG 用户单位映射到 CSS px 后的宽高） */
  width: number;
  height: number;
  /** viewBox（没有时为 0,0,width,height） */
  viewBox: { x: number; y: number; w: number; h: number };
  report: SanitizeReport;
}

export class SvgParseError extends Error {}

function num(v: string | null): number | null {
  if (v == null) return null;
  const m = /^\s*(-?[\d.]+(?:e[-+]?\d+)?)\s*(px)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 从 <svg> 的 width/height/viewBox 推出内容尺寸 */
export function svgDimensions(
  widthAttr: string | null,
  heightAttr: string | null,
  viewBoxAttr: string | null,
): { width: number; height: number; viewBox: { x: number; y: number; w: number; h: number } } {
  let vb: { x: number; y: number; w: number; h: number } | null = null;
  if (viewBoxAttr) {
    const p = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0) vb = { x: p[0], y: p[1], w: p[2], h: p[3] };
  }
  let w = num(widthAttr);
  let h = num(heightAttr);
  if (w == null && h == null) {
    w = vb?.w ?? 300;
    h = vb?.h ?? 150;
  } else if (w == null) {
    w = vb ? (h! * vb.w) / vb.h : h!;
  } else if (h == null) {
    h = vb ? (w * vb.h) / vb.w : w;
  }
  return { width: w, height: h!, viewBox: vb ?? { x: 0, y: 0, w: w, h: h! } };
}

/**
 * 解析 + 清洗 SVG 文本。抛出 SvgParseError 表示内容不是合法 SVG。
 * 内嵌 <style> 会被移除（它在 HTML 中是全局样式，会污染整个页面）；显示样式由 schematic.css 提供。
 */
export function parseSvg(text: string, doc: Document = document): ParsedSvg {
  if (!text || !text.trim()) throw new SvgParseError('SVG 内容为空');
  if (/<!ENTITY/i.test(text)) throw new SvgParseError('SVG 含有不支持的 DTD 实体声明');
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = parsed.getElementsByTagName('parsererror')[0];
  if (err) {
    const raw = (err.textContent ?? '').trim();
    // Chrome/Firefox 的错误文本带有大段说明，只取具体的出错位置
    const detail = /(error on line[^\n]*|XML Parsing Error[^\n]*|[^\n]*line \d+[^\n]*)/i.exec(raw)?.[1] ?? raw;
    throw new SvgParseError('SVG 解析失败：' + detail.replace(/^This page contains the following errors:\s*/i, '').slice(0, 200));
  }
  const root = parsed.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) throw new SvgParseError('不是 SVG 文档');
  const report = sanitizeTree(root);
  const dims = svgDimensions(root.getAttribute('width'), root.getAttribute('height'), root.getAttribute('viewBox'));
  const svg = doc.importNode(root, true) as unknown as SVGSVGElement;
  return { svg, ...dims, report };
}
