// 一次 AI 电路板设计任务的状态：提交、订阅 SSE、把事件折叠成活动日志与当前设计。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PcbDesign, PcbDrcReport, PcbRunEvent, PcbRunStatus, PcbSnapshot, PcbUsage } from '@webeda/shared';
import { api } from '../../lib/api';

export type LogItem =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; summary: string; ok: boolean }
  | { kind: 'end'; status: PcbRunStatus; text: string };

export interface PcbRunState {
  running: boolean;
  log: LogItem[];
  design: PcbDesign | null;
  drc: PcbDrcReport | null;
  usage: PcbUsage | null;
  model: string | null;
}

const STORAGE_KEY = 'webeda.pcb.snapshot';

function loadSaved(): PcbSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const snap = raw ? (JSON.parse(raw) as PcbSnapshot) : null;
    return snap?.design?.components && snap.drc?.ratsnest ? snap : null;
  } catch {
    return null;
  }
}

/** 把一个事件折叠进日志：连续的文字/思考增量并入同一条 */
export function reduceLog(log: LogItem[], ev: PcbRunEvent): LogItem[] {
  switch (ev.type) {
    case 'text':
    case 'thinking': {
      const last = log[log.length - 1];
      if (last?.kind === ev.type) return [...log.slice(0, -1), { kind: ev.type, text: last.text + ev.text }];
      return [...log, { kind: ev.type, text: ev.text }];
    }
    case 'tool':
      return [...log, { kind: 'tool', name: ev.name, summary: ev.summary, ok: ev.ok }];
    case 'end': {
      const text =
        ev.status === 'succeeded'
          ? ev.drc.errors
            ? `设计结束，但 DRC 还有 ${ev.drc.errors} 个错误`
            : '设计完成，DRC 通过'
          : ev.status === 'cancelled'
            ? '已取消'
            : (ev.error ?? '设计失败');
      return [...log, { kind: 'end', status: ev.status, text }];
    }
    default:
      return log;
  }
}

export function usePcbRun() {
  const [state, setState] = useState<PcbRunState>(() => {
    const saved = loadSaved();
    return { running: false, log: [], design: saved?.design ?? null, drc: saved?.drc ?? null, usage: null, model: null };
  });
  const source = useRef<EventSource | null>(null);
  const runId = useRef<string | null>(null);

  useEffect(() => () => source.current?.close(), []);

  // 当前设计存在本地，刷新页面后还在
  useEffect(() => {
    if (state.running) return;
    try {
      if (state.design && state.drc) localStorage.setItem(STORAGE_KEY, JSON.stringify({ design: state.design, drc: state.drc }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 存不下就算了 */
    }
  }, [state.design, state.drc, state.running]);

  const start = useCallback(async (prompt: string, base: PcbDesign | null) => {
    source.current?.close();
    setState((s) => ({ ...s, running: true, usage: null, model: null, log: [...s.log, { kind: 'user', text: prompt }] }));
    let id: string;
    try {
      ({ id } = await api.createPcbRun({ prompt, design: base ?? undefined }));
    } catch (e) {
      setState((s) => ({ ...s, running: false, log: [...s.log, { kind: 'end', status: 'failed', text: (e as Error).message }] }));
      return;
    }
    runId.current = id;
    const es = new EventSource(api.pcbRunEventsUrl(id));
    source.current = es;
    let finished = false;
    const on = (type: PcbRunEvent['type']) =>
      es.addEventListener(type, (e) => {
        const ev = JSON.parse((e as MessageEvent).data) as PcbRunEvent;
        setState((s) => {
          const next = { ...s, log: reduceLog(s.log, ev) };
          if (ev.type === 'design') Object.assign(next, { design: ev.design, drc: ev.drc });
          else if (ev.type === 'usage') next.usage = ev.usage;
          else if (ev.type === 'end') {
            // 一开始就失败（如凭据无效）时服务端返回的是空板，不要用它覆盖已有设计
            const keep = ev.design.components.length > 0;
            Object.assign(next, { running: false, usage: ev.usage, model: ev.model, ...(keep ? { design: ev.design, drc: ev.drc } : {}) });
          }
          return next;
        });
        if (ev.type === 'end') {
          finished = true;
          es.close();
        }
      });
    (['turn', 'text', 'thinking', 'tool', 'design', 'usage', 'end'] as const).forEach(on);
    es.onerror = () => {
      if (finished) return;
      es.close();
      setState((s) => ({ ...s, running: false, log: [...s.log, { kind: 'end', status: 'failed', text: '与服务端的连接中断' }] }));
    };
  }, []);

  const cancel = useCallback(() => {
    if (runId.current) void api.cancelPcbRun(runId.current).catch(() => {});
  }, []);

  const load = useCallback((snap: PcbSnapshot | null) => {
    setState((s) => ({ ...s, design: snap?.design ?? null, drc: snap?.drc ?? null, log: snap ? s.log : [], usage: snap ? s.usage : null }));
  }, []);

  return { ...state, start, cancel, load };
}
