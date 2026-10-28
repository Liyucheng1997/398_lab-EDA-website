import type { ExampleCategory, ExampleSummary, ProjectSummary, ToolInfo } from '@webeda/shared';
import { getBoard, getDevice } from '@webeda/shared';

/** 首页示例画廊的筛选项：'all' + 各分类 */
export type GalleryFilter = 'all' | ExampleCategory;

export const CATEGORY_LABELS: Record<ExampleCategory, string> = {
  basics: '入门',
  combinational: '组合逻辑',
  sequential: '时序逻辑',
  fsm: '状态机',
  memory: '存储器',
  interface: '接口',
  verification: '验证',
  board: '板卡模板',
};

const CATEGORY_ORDER: ExampleCategory[] = ['basics', 'combinational', 'sequential', 'fsm', 'memory', 'interface', 'verification', 'board'];

/** 只列出实际有示例的分类（保持固定顺序），前面加「全部」 */
export function galleryFilters(examples: ExampleSummary[]): { id: GalleryFilter; label: string; count: number }[] {
  const counts = new Map<ExampleCategory, number>();
  for (const e of examples) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return [
    { id: 'all', label: '全部', count: examples.length },
    ...CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({ id: c, label: CATEGORY_LABELS[c], count: counts.get(c) ?? 0 })),
  ];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 按分类与关键字（标题 / 描述 / id / 分类名 / 板卡名，空格分隔的多个词须全部命中）筛选 */
export function filterExamples(examples: ExampleSummary[], filter: GalleryFilter, query: string): ExampleSummary[] {
  const words = normalize(query).split(' ').filter(Boolean);
  return examples.filter((e) => {
    if (filter !== 'all' && e.category !== filter) return false;
    if (!words.length) return true;
    const hay = normalize(
      [e.title, e.description, e.id, CATEGORY_LABELS[e.category] ?? '', e.board ? (getBoard(e.board)?.name ?? e.board) : ''].join(' '),
    );
    return words.every((w) => hay.includes(w));
  });
}

/** 示例卡片点击后的去向：Studio 模板进新建工程向导，其余进 Playground */
export function exampleHref(e: Pick<ExampleSummary, 'id' | 'scope'>): string {
  return e.scope === 'studio'
    ? `/studio?template=${encodeURIComponent(e.id)}`
    : `/playground?example=${encodeURIComponent(e.id)}`;
}

/** 示例卡片右下角的去向标签 */
export function exampleTarget(e: Pick<ExampleSummary, 'scope' | 'board'>): string {
  if (e.scope !== 'studio') return 'Playground';
  const board = e.board ? getBoard(e.board) : undefined;
  return board ? `Studio · ${board.name}` : 'Studio';
}

/** 板卡对应的器件是否支持完整实现（布局布线 + 比特流） */
export function exampleSupportsBitstream(e: Pick<ExampleSummary, 'board'>): boolean | null {
  const board = e.board ? getBoard(e.board) : undefined;
  if (!board) return null;
  return getDevice(board.device)?.pnr ?? null;
}

/** 按时间段问候 */
export function greeting(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 日期 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 最近更新的工程（按 updatedAt 倒序，无效时间排在最后） */
export function recentProjects(projects: ProjectSummary[], limit = 6): ProjectSummary[] {
  const time = (p: ProjectSummary) => {
    const t = Date.parse(p.updatedAt);
    return Number.isFinite(t) ? t : -Infinity;
  };
  return [...projects].sort((a, b) => time(b) - time(a)).slice(0, Math.max(0, limit));
}

/** 工程副标题：器件 · 板卡 · 文件数 */
export function projectSubtitle(p: ProjectSummary): string {
  const parts = [getDevice(p.device)?.name ?? p.device];
  if (p.board) parts.push(getBoard(p.board)?.name ?? p.board);
  parts.push(`${p.fileCount} 个文件`);
  return parts.join(' · ');
}

export const RUNTIME_LABELS: Record<ToolInfo['runtime'], string> = {
  native: '本机',
  wasm: 'WebAssembly',
  js: 'JavaScript',
};

/** 工具链汇总：可用数 / 总数 */
export function toolSummary(tools: ToolInfo[]): { available: number; total: number; allOk: boolean } {
  const available = tools.filter((t) => t.available).length;
  return { available, total: tools.length, allOk: tools.length > 0 && available === tools.length };
}
