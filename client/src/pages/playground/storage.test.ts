import { describe, expect, it } from 'vitest';
import { templateDoc } from './model';
import {
  clearDraft,
  clearLocal,
  DRAFT_KEY,
  loadDraft,
  loadFlag,
  loadLayout,
  loadLocal,
  saveDraft,
  saveFlag,
  saveLayout,
  saveLocal,
  type KV,
} from './storage';

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwingKV: KV = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('draft storage', () => {
  it('round-trips a draft', () => {
    const kv = memoryKV();
    const doc = templateDoc();
    expect(saveDraft({ doc, baseline: 'abc', source: 'counter' }, kv)).toBe(true);
    const d = loadDraft(kv);
    expect(d?.doc.files.map((f) => f.name)).toEqual(doc.files.map((f) => f.name));
    expect(d?.baseline).toBe('abc');
    expect(d?.source).toBe('counter');
    clearDraft(kv);
    expect(loadDraft(kv)).toBeNull();
  });
  it('ignores corrupt data', () => {
    const kv = memoryKV();
    kv.setItem(DRAFT_KEY, '{not json');
    expect(loadDraft(kv)).toBeNull();
    kv.setItem(DRAFT_KEY, JSON.stringify({ doc: { files: 3 } }));
    expect(loadDraft(kv)).toBeNull();
  });
  it('survives a throwing or missing storage', () => {
    expect(loadDraft(throwingKV)).toBeNull();
    expect(saveDraft({ doc: templateDoc(), baseline: '' }, throwingKV)).toBe(false);
    expect(() => clearDraft(throwingKV)).not.toThrow();
    expect(loadDraft(null)).toBeNull();
    expect(saveDraft({ doc: templateDoc(), baseline: '' }, null)).toBe(false);
  });
});

describe('local copies and layout', () => {
  it('round-trips a local copy per id', () => {
    const kv = memoryKV();
    saveLocal('p1', templateDoc(), '2024-01-01', kv);
    expect(loadLocal('p1', kv)?.baseUpdatedAt).toBe('2024-01-01');
    expect(loadLocal('p2', kv)).toBeNull();
    clearLocal('p1', kv);
    expect(loadLocal('p1', kv)).toBeNull();
  });
  it('stores layout and removes empty layouts', () => {
    const kv = memoryKV();
    saveLayout('p1', { 'rom.hex': 'tb' }, kv);
    expect(loadLayout('p1', kv)).toEqual({ 'rom.hex': 'tb' });
    saveLayout('p1', {}, kv);
    expect(kv.data.size).toBe(0);
    kv.setItem('webeda.playground.layout.p2', JSON.stringify({ a: 'tb', b: 'nope' }));
    expect(loadLayout('p2', kv)).toEqual({ a: 'tb' });
  });
  it('stores boolean flags', () => {
    const kv = memoryKV();
    expect(loadFlag('k', true, kv)).toBe(true);
    saveFlag('k', false, kv);
    expect(loadFlag('k', true, kv)).toBe(false);
  });
});
