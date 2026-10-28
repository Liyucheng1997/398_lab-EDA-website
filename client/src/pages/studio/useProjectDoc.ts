import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectInput } from '@webeda/shared';
import { api } from '../../lib/api';
import { toast } from '../../ui/toast';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'notfound' }
  | { status: 'error'; message: string };

const AUTOSAVE_MS = 800;

function toInput(p: Project): ProjectInput {
  return { name: p.name, description: p.description, files: p.files, settings: p.settings, runs: p.runs };
}

/**
 * 工程文档：加载、本地修改、800ms 防抖自动保存（含 runs），串行化保存请求。
 */
export function useProjectDoc(id: string | undefined) {
  const [project, setProject] = useState<Project | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);

  const ref = useRef<Project | null>(null);
  const rev = useRef(0);
  const savedRev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const errorShown = useRef(false);
  const idRef = useRef(id);
  idRef.current = id;

  const reload = useCallback(async () => {
    if (!id) {
      setLoad({ status: 'notfound' });
      return;
    }
    setLoad({ status: 'loading' });
    try {
      const p = await api.getProject(id);
      if (idRef.current !== id) return;
      const normalized: Project = { ...p, runs: Array.isArray(p.runs) ? p.runs : [], files: Array.isArray(p.files) ? p.files : [] };
      ref.current = normalized;
      rev.current = 0;
      savedRev.current = 0;
      setProject(normalized);
      setSaveState('saved');
      setLoad({ status: 'ready' });
    } catch (e) {
      const msg = (e as Error).message;
      if (/不存在|not found|404/i.test(msg)) setLoad({ status: 'notfound' });
      else setLoad({ status: 'error', message: msg });
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const doSave = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) {
      // 正在保存：等它结束后若仍有新改动再存一次
      await saving.current;
      if (rev.current !== savedRev.current) return doSave();
      return;
    }
    const snapshot = ref.current;
    const pid = idRef.current;
    if (!snapshot || !pid || rev.current === savedRev.current) return;
    const target = rev.current;
    setSaveState('saving');
    const run = (async () => {
      try {
        await api.updateProject(pid, toInput(snapshot));
        savedRev.current = Math.max(savedRev.current, target);
        errorShown.current = false;
        setSaveError(null);
        setSaveState(rev.current === savedRev.current ? 'saved' : 'dirty');
      } catch (e) {
        const msg = (e as Error).message;
        setSaveError(msg);
        setSaveState('error');
        if (!errorShown.current) {
          errorShown.current = true;
          toast(`保存失败：${msg}`, 'error', 4000);
        }
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
    if (rev.current !== savedRev.current && !errorShown.current) {
      timer.current = setTimeout(() => void doSave(), AUTOSAVE_MS);
    }
  }, []);

  /** 修改工程（同步更新本地状态并安排自动保存） */
  const update = useCallback(
    (fn: (p: Project) => Project) => {
      const cur = ref.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      ref.current = next;
      rev.current++;
      setProject(next);
      setSaveState('dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void doSave(), AUTOSAVE_MS);
    },
    [doSave],
  );

  /** 立即保存（Ctrl+S） */
  const flush = useCallback(async () => {
    errorShown.current = false;
    if (rev.current === savedRev.current && saveState !== 'error') return;
    if (rev.current === savedRev.current) rev.current++;
    await doSave();
  }, [doSave, saveState]);

  /** 读取最新工程（回调中使用，避免闭包里的旧值） */
  const getLatest = useCallback(() => ref.current, []);

  // 未保存时离开页面提醒
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (rev.current !== savedRev.current) {
        e.preventDefault();
        void doSave();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [doSave]);

  // 卸载（切换路由）时立即保存未保存的修改
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (rev.current !== savedRev.current) void doSave();
    },
    [doSave],
  );

  return { project, load, saveState, saveError, update, flush, reload, getLatest };
}

export type ProjectDoc = ReturnType<typeof useProjectDoc>;
