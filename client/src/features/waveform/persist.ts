// 查看器状态的持久化（localStorage：webeda.wave.<key>）。

import { isRadix, type Radix } from './format';

export interface PersistedTrace {
  path: string;
  radix: Radix;
  analog?: boolean;
  expanded?: boolean;
}

export interface PersistedState {
  v: 1;
  traces: PersistedTrace[];
  /** 可见时间范围；fit = 处于"适应窗口"状态（新波形时重新适应） */
  view?: { start: number; end: number; fit: boolean };
  defaultRadix?: Radix;
}

const PREFIX = 'webeda.wave.';

/** 校验并清洗从 localStorage 读出的对象 */
export function sanitizePersisted(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.traces)) return null;
  const traces: PersistedTrace[] = [];
  for (const t of o.traces) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (typeof r.path !== 'string' || !r.path) continue;
    traces.push({
      path: r.path,
      radix: isRadix(r.radix) ? r.radix : 'hex',
      analog: r.analog === true,
      expanded: r.expanded === true,
    });
  }
  let view: PersistedState['view'];
  const v = o.view as Record<string, unknown> | undefined;
  if (v && typeof v === 'object' && Number.isFinite(v.start) && Number.isFinite(v.end) && (v.end as number) > (v.start as number)) {
    view = { start: v.start as number, end: v.end as number, fit: v.fit === true };
  }
  return { v: 1, traces, view, defaultRadix: isRadix(o.defaultRadix) ? o.defaultRadix : undefined };
}

export function loadPersisted(key: string | undefined): PersistedState | null {
  if (!key) return null;
  try {
    const s = localStorage.getItem(PREFIX + key);
    return s ? sanitizePersisted(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

export function savePersisted(key: string | undefined, state: PersistedState): void {
  if (!key) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(state));
  } catch {
    /* 配额满或隐私模式：忽略 */
  }
}
