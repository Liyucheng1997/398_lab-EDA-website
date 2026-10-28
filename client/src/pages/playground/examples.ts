import type { ExampleCategory, ExampleSummary } from '@webeda/shared';

export const CATEGORY_LABEL: Record<ExampleCategory, string> = {
  basics: '入门',
  combinational: '组合逻辑',
  sequential: '时序逻辑',
  fsm: '状态机',
  memory: '存储器',
  interface: '接口与总线',
  verification: '验证',
  board: '板级设计',
};

const CATEGORY_ORDER: ExampleCategory[] = ['basics', 'combinational', 'sequential', 'fsm', 'memory', 'interface', 'verification', 'board'];

/** 过滤 + 分组（纯函数，供测试） */
export function groupExamples(list: ExampleSummary[], query: string): { category: ExampleCategory; items: ExampleSummary[] }[] {
  const q = query.trim().toLowerCase();
  const filtered = list.filter(
    (e) =>
      (e.scope === 'playground' || e.scope === 'both') &&
      (!q ||
        e.title.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (CATEGORY_LABEL[e.category] ?? '').includes(q)),
  );
  const groups = new Map<ExampleCategory, ExampleSummary[]>();
  for (const e of filtered) {
    const arr = groups.get(e.category) ?? [];
    arr.push(e);
    groups.set(e.category, arr);
  }
  const rank = (c: ExampleCategory) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? CATEGORY_ORDER.length : i;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([category, items]) => ({ category, items }));
}
