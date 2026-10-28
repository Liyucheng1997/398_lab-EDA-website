import { describe, expect, it } from 'vitest';
import type { ExampleSummary, ProjectSummary, ToolInfo } from '@webeda/shared';
import {
  exampleHref,
  exampleSupportsBitstream,
  exampleTarget,
  filterExamples,
  galleryFilters,
  greeting,
  projectSubtitle,
  recentProjects,
  relativeTime,
  toolSummary,
} from './model';

const EX: ExampleSummary[] = [
  { id: 'counter', title: '4 位计数器', description: '带同步复位的计数器', category: 'basics', scope: 'playground' },
  { id: 'alu', title: '行波进位加法器与 ALU', description: '枚举操作码 ripple carry', category: 'combinational', scope: 'playground' },
  { id: 'uart-loopback', title: 'UART 收发回环', description: '8N1 UART', category: 'interface', scope: 'playground' },
  { id: 'icebreaker-blinky', title: 'iCEBreaker 闪灯', description: 'iCE40 UP5K 入门', category: 'board', scope: 'studio', board: 'icebreaker' },
  { id: 'basys3-stopwatch', title: 'Basys 3 秒表', description: '数码管', category: 'board', scope: 'studio', board: 'basys3' },
];

describe('示例筛选', () => {
  it('分类按固定顺序，只包含有示例的分类', () => {
    const f = galleryFilters(EX);
    expect(f.map((x) => x.id)).toEqual(['all', 'basics', 'combinational', 'interface', 'board']);
    expect(f[0].count).toBe(5);
    expect(f.find((x) => x.id === 'board')?.count).toBe(2);
    expect(galleryFilters([])).toEqual([{ id: 'all', label: '全部', count: 0 }]);
  });

  it('按分类与关键字筛选（大小写不敏感、多词全部命中、可搜分类名与板卡名）', () => {
    expect(filterExamples(EX, 'all', '').length).toBe(5);
    expect(filterExamples(EX, 'board', '').map((e) => e.id)).toEqual(['icebreaker-blinky', 'basys3-stopwatch']);
    expect(filterExamples(EX, 'all', 'uart').map((e) => e.id)).toEqual(['uart-loopback']);
    expect(filterExamples(EX, 'all', '  RIPPLE   carry ').map((e) => e.id)).toEqual(['alu']);
    expect(filterExamples(EX, 'all', '组合逻辑').map((e) => e.id)).toEqual(['alu']);
    expect(filterExamples(EX, 'all', 'basys').map((e) => e.id)).toEqual(['basys3-stopwatch']);
    expect(filterExamples(EX, 'basics', 'uart')).toEqual([]);
  });

  it('链接与去向标签', () => {
    expect(exampleHref(EX[0])).toBe('/playground?example=counter');
    expect(exampleHref(EX[3])).toBe('/studio?template=icebreaker-blinky');
    expect(exampleHref({ id: 'a b', scope: 'both' })).toBe('/playground?example=a%20b');
    expect(exampleTarget(EX[0])).toBe('Playground');
    expect(exampleTarget(EX[3])).toBe('Studio · iCEBreaker');
    expect(exampleTarget({ scope: 'studio', board: 'nope' })).toBe('Studio');
    expect(exampleSupportsBitstream(EX[3])).toBe(true);
    expect(exampleSupportsBitstream(EX[4])).toBe(false);
    expect(exampleSupportsBitstream(EX[0])).toBeNull();
  });
});

describe('时间与问候', () => {
  it('greeting', () => {
    expect(greeting(3)).toBe('夜深了');
    expect(greeting(8)).toBe('早上好');
    expect(greeting(12)).toBe('中午好');
    expect(greeting(15)).toBe('下午好');
    expect(greeting(21)).toBe('晚上好');
  });

  it('relativeTime', () => {
    const now = Date.parse('2026-10-28T12:00:00Z');
    expect(relativeTime('2026-10-28T11:59:30Z', now)).toBe('刚刚');
    expect(relativeTime('2026-10-28T11:30:00Z', now)).toBe('30 分钟前');
    expect(relativeTime('2026-10-28T07:00:00Z', now)).toBe('5 小时前');
    expect(relativeTime('2026-10-27T10:00:00Z', now)).toBe('昨天');
    expect(relativeTime('2026-10-24T12:00:00Z', now)).toBe('4 天前');
    expect(relativeTime('2026-10-28T13:00:00Z', now)).toBe('刚刚'); // 未来时间（时钟偏差）
    expect(relativeTime('不是时间', now)).toBe('');
    expect(relativeTime('2025-03-01T12:00:00Z', now)).toMatch(/^2025 年 3 月 [12] 日$/);
  });
});

describe('工程与工具链', () => {
  const P = (id: string, updatedAt: string): ProjectSummary => ({
    id,
    name: id,
    device: 'ice40-up5k-sg48',
    board: 'icebreaker',
    updatedAt,
    fileCount: 3,
  });

  it('recentProjects 按更新时间倒序并截断', () => {
    const list = [P('a', '2026-01-01T00:00:00Z'), P('b', 'bad'), P('c', '2026-03-01T00:00:00Z'), P('d', '2026-02-01T00:00:00Z')];
    expect(recentProjects(list, 3).map((p) => p.id)).toEqual(['c', 'd', 'a']);
    expect(recentProjects(list).map((p) => p.id)).toEqual(['c', 'd', 'a', 'b']);
    expect(recentProjects(list, 0)).toEqual([]);
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']); // 不修改原数组
  });

  it('projectSubtitle', () => {
    expect(projectSubtitle(P('x', ''))).toBe('iCE40 UP5K · iCEBreaker · 3 个文件');
    expect(projectSubtitle({ ...P('x', ''), board: undefined, device: 'xc7a35t-cpg236', fileCount: 1 })).toBe('Artix-7 35T · 1 个文件');
  });

  it('toolSummary', () => {
    const t = (id: ToolInfo['id'], available: boolean): ToolInfo => ({ id, name: id, version: '1', available, runtime: 'wasm' });
    expect(toolSummary([t('yosys', true), t('iverilog', false)])).toEqual({ available: 1, total: 2, allOk: false });
    expect(toolSummary([t('yosys', true)])).toEqual({ available: 1, total: 1, allOk: true });
    expect(toolSummary([])).toEqual({ available: 0, total: 0, allOk: false });
  });
});
