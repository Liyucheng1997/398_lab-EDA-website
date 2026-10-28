import { describe, expect, it } from 'vitest';
import type { ExampleSummary } from '@webeda/shared';
import { groupExamples } from './examples';

const ex = (id: string, category: ExampleSummary['category'], scope: ExampleSummary['scope'], title = id, description = ''): ExampleSummary => ({
  id,
  title,
  description,
  category,
  scope,
});

describe('groupExamples', () => {
  const list = [
    ex('fsm1', 'fsm', 'playground', '交通灯'),
    ex('blink', 'board', 'studio'),
    ex('cnt', 'basics', 'both', '计数器', 'counter with reset'),
    ex('alu', 'combinational', 'playground', 'ALU'),
    ex('cnt2', 'basics', 'playground', 'Up/Down'),
  ];
  it('keeps playground/both scope and orders by category', () => {
    const g = groupExamples(list, '');
    expect(g.map((x) => x.category)).toEqual(['basics', 'combinational', 'fsm']);
    expect(g[0].items.map((x) => x.id)).toEqual(['cnt', 'cnt2']);
  });
  it('searches title, description, id and category label', () => {
    expect(groupExamples(list, 'COUNTER').flatMap((g) => g.items.map((i) => i.id))).toEqual(['cnt']);
    expect(groupExamples(list, 'alu').flatMap((g) => g.items.map((i) => i.id))).toEqual(['alu']);
    expect(groupExamples(list, '状态机').flatMap((g) => g.items.map((i) => i.id))).toEqual(['fsm1']);
    expect(groupExamples(list, 'blink')).toEqual([]);
  });
});
