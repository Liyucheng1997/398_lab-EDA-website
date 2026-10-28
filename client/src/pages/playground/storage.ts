/**
 * Playground 本地持久化：未保存的草稿（/playground）、已保存 playground 的本地脏副本、
 * 以及非 HDL 文件的左右面板布局。所有读写都容错（隐私模式 / 配额不足 / 脏数据）。
 */
import { sanitizeDoc, type Pane, type PgDoc } from './model';

export const DRAFT_KEY = 'webeda.playground.draft';
export const LOCAL_PREFIX = 'webeda.playground.local.';
export const LAYOUT_PREFIX = 'webeda.playground.layout.';
export const SIDEBAR_KEY = 'webeda.playground.sidebar';
export const BOTTOM_KEY = 'webeda.playground.bottom';

/** 可注入的存储，便于测试 */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultKV(): KV | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson(kv: KV | null, key: string): unknown {
  if (!kv) return null;
  try {
    const raw = kv.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 写入成功返回 true；配额不足等返回 false */
function writeJson(kv: KV | null, key: string, value: unknown): boolean {
  if (!kv) return false;
  try {
    kv.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(kv: KV | null, key: string) {
  try {
    kv?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* ───────────── 草稿 ───────────── */

export interface StoredDraft {
  doc: PgDoc;
  /** 草稿来源（模板/示例）内容签名，用于判断是否有修改 */
  baseline: string;
  /** 来源说明，如示例 id */
  source?: string;
  savedAt: number;
}

export function loadDraft(kv: KV | null = defaultKV()): StoredDraft | null {
  const raw = readJson(kv, DRAFT_KEY) as Partial<StoredDraft> | null;
  if (!raw || typeof raw !== 'object') return null;
  const doc = sanitizeDoc(raw.doc);
  if (!doc) return null;
  return {
    doc,
    baseline: typeof raw.baseline === 'string' ? raw.baseline : '',
    source: typeof raw.source === 'string' ? raw.source : undefined,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  };
}

export function saveDraft(d: Omit<StoredDraft, 'savedAt'>, kv: KV | null = defaultKV()): boolean {
  return writeJson(kv, DRAFT_KEY, { ...d, savedAt: Date.now() });
}

export function clearDraft(kv: KV | null = defaultKV()) {
  remove(kv, DRAFT_KEY);
}

/* ───────────── 已保存 playground 的本地脏副本 ───────────── */

export interface StoredLocal {
  doc: PgDoc;
  /** 修改基于的服务端版本 updatedAt */
  baseUpdatedAt: string;
  savedAt: number;
}

export function loadLocal(id: string, kv: KV | null = defaultKV()): StoredLocal | null {
  const raw = readJson(kv, LOCAL_PREFIX + id) as Partial<StoredLocal> | null;
  if (!raw || typeof raw !== 'object') return null;
  const doc = sanitizeDoc(raw.doc);
  if (!doc) return null;
  return {
    doc,
    baseUpdatedAt: typeof raw.baseUpdatedAt === 'string' ? raw.baseUpdatedAt : '',
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  };
}

export function saveLocal(id: string, doc: PgDoc, baseUpdatedAt: string, kv: KV | null = defaultKV()): boolean {
  return writeJson(kv, LOCAL_PREFIX + id, { doc, baseUpdatedAt, savedAt: Date.now() });
}

export function clearLocal(id: string, kv: KV | null = defaultKV()) {
  remove(kv, LOCAL_PREFIX + id);
}

/* ───────────── 非 HDL 文件面板布局 ───────────── */

export function loadLayout(id: string, kv: KV | null = defaultKV()): Record<string, Pane> {
  const raw = readJson(kv, LAYOUT_PREFIX + id);
  const out: Record<string, Pane> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === 'tb' || v === 'design') out[k] = v;
  }
  return out;
}

export function saveLayout(id: string, layout: Record<string, Pane>, kv: KV | null = defaultKV()) {
  if (Object.keys(layout).length === 0) remove(kv, LAYOUT_PREFIX + id);
  else writeJson(kv, LAYOUT_PREFIX + id, layout);
}

/* ───────────── 小偏好 ───────────── */

export function loadFlag(key: string, fallback: boolean, kv: KV | null = defaultKV()): boolean {
  const v = readJson(kv, key);
  return typeof v === 'boolean' ? v : fallback;
}

export function saveFlag(key: string, value: boolean, kv: KV | null = defaultKV()) {
  writeJson(kv, key, value);
}
