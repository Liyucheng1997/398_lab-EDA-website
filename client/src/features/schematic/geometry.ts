// 平移缩放与命中测试的纯函数（原理图与器件视图共用）。

/** 视图变换：屏幕坐标 = 内容坐标 * k + (x, y) */
export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export const IDENTITY: ViewTransform = { x: 0, y: 0, k: 1 };

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 让 contentW×contentH 的内容居中适配 viewW×viewH 的视口（留 padding 像素边距），不放大超过 maxK */
export function fitTransform(
  contentW: number,
  contentH: number,
  viewW: number,
  viewH: number,
  padding = 24,
  minK = 0.01,
  maxK = 1,
): ViewTransform {
  if (!(contentW > 0 && contentH > 0 && viewW > 0 && viewH > 0)) return { ...IDENTITY };
  const availW = Math.max(1, viewW - padding * 2);
  const availH = Math.max(1, viewH - padding * 2);
  const k = clamp(Math.min(availW / contentW, availH / contentH), minK, maxK);
  return { k, x: (viewW - contentW * k) / 2, y: (viewH - contentH * k) / 2 };
}

/** 以屏幕点 (px, py) 为不动点缩放到 newK */
export function zoomAt(t: ViewTransform, px: number, py: number, newK: number): ViewTransform {
  const r = newK / t.k;
  return { k: newK, x: px - (px - t.x) * r, y: py - (py - t.y) * r };
}

/** 屏幕坐标 → 内容坐标 */
export function toContent(t: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
}

/** 平移使内容点 (cx, cy) 位于视口中心 */
export function centerOn(t: ViewTransform, cx: number, cy: number, viewW: number, viewH: number): ViewTransform {
  return { k: t.k, x: viewW / 2 - cx * t.k, y: viewH / 2 - cy * t.k };
}

/** 滚轮 deltaY → 缩放倍率（统一 deltaMode：0 像素 / 1 行 / 2 页） */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -300, 300) * 0.002);
}

/** 统一滚轮平移量（像素） */
export function wheelPixels(delta: number, deltaMode = 0): number {
  return deltaMode === 1 ? delta * 16 : deltaMode === 2 ? delta * 400 : delta;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 点到线段距离的平方 */
export function distToSegmentSq(px: number, py: number, s: Segment): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = s.x1 + t * dx - px;
  const cy = s.y1 + t * dy - py;
  return cx * cx + cy * cy;
}

/** 在 tol 范围内找离点最近的线段，返回下标；没有返回 -1 */
export function nearestSegment(segs: ArrayLike<Segment>, px: number, py: number, tol: number): number {
  let best = -1;
  let bestD = tol * tol;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // 先做包围盒快速排除
    if (px < Math.min(s.x1, s.x2) - tol || px > Math.max(s.x1, s.x2) + tol) continue;
    if (py < Math.min(s.y1, s.y2) - tol || py > Math.max(s.y1, s.y2) + tol) continue;
    const d = distToSegmentSq(px, py, s);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** netlistsvg 的网络类名形如 "net_4,5,6,7"；返回第一个 net_ 类名 */
export function netClassOf(classAttr: string | null | undefined): string | null {
  if (!classAttr) return null;
  for (const c of classAttr.split(/\s+/)) if (c.startsWith('net_') && c.length > 4) return c;
  return null;
}

/** 网络位宽 = net_ 后逗号分隔的位编号个数（常量位如 "0"/"1"/"x" 也计入） */
export function netWidth(netClass: string): number {
  const body = netClass.slice(4).replace(/^,+|,+$/g, '');
  if (!body) return 1;
  return body.split(',').filter(Boolean).length;
}

/** 截取 cell_xxx / port_xxx~p 的名字部分 */
export function cellNameFromId(id: string | null | undefined): string | null {
  if (!id || !id.startsWith('cell_')) return null;
  return id.slice(5);
}

/** 不区分大小写的子串匹配；空查询不匹配任何内容 */
export function matchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length > 0 && label.toLowerCase().includes(q);
}

/** 文件名清洗：去掉 Windows/Unix 非法字符 */
export function safeFileName(name: string, fallback = 'schematic'): string {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
  return s || fallback;
}

/** 导出 PNG 时的画布尺寸：在不超过浏览器画布上限的前提下尽量取 scale 倍 */
export function exportCanvasSize(
  w: number,
  h: number,
  scale = 2,
  maxSide = 16384,
  maxArea = 120_000_000,
): { width: number; height: number; scale: number } {
  let s = scale;
  if (w * s > maxSide) s = maxSide / w;
  if (h * s > maxSide) s = Math.min(s, maxSide / h);
  if (w * h * s * s > maxArea) s = Math.min(s, Math.sqrt(maxArea / (w * h)));
  const width = Math.max(1, Math.floor(w * s));
  const height = Math.max(1, Math.floor(h * s));
  return { width, height, scale: s };
}
