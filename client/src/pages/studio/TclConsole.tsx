import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Square, Trash2 } from 'lucide-react';
import type { SourceFile } from '@webeda/shared';
import { startJob, type RunningJob } from '../../lib/api';
import { consoleScript, filesForKind, stripAnsi } from './model';

interface Entry {
  id: number;
  type: 'cmd' | 'out' | 'err' | 'info';
  text: string;
}

const MAX_ENTRIES = 3000;
const MAX_HISTORY = 100;

function loadHistory(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

const WELCOME = '输入 Yosys 命令并回车执行，例如 stat、ls、select -list t:*、check、opt; stat。\n每条命令会读入工程的设计源文件并确定顶层后执行；勾选"原始脚本"则只运行你输入的内容。clear 清屏，↑/↓ 浏览历史。\n';

/** 类 Vivado Tcl Console：每条命令作为一个 Yosys 任务运行 */
export function TclConsole({ projectId, files, top }: { projectId: string; files: SourceFile[]; top?: string }) {
  const historyKey = `webeda.studio.tcl.${projectId}`;
  const [entries, setEntries] = useState<Entry[]>(() => [{ id: 0, type: 'info', text: WELCOME }]);
  const [input, setInput] = useState('');
  const [raw, setRaw] = useState(false);
  const [running, setRunning] = useState(false);
  const [initialHistory] = useState(() => loadHistory(historyKey));
  const history = useRef<string[]>(initialHistory);
  const histIdx = useRef<number>(-1);
  const draft = useRef('');
  const seq = useRef(1);
  const job = useRef<RunningJob | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const topRef = useRef(top);
  topRef.current = top;

  const append = useCallback((type: Entry['type'], raw: string) => {
    const text = stripAnsi(raw);
    setEntries((es) => {
      const last = es[es.length - 1];
      // 合并连续的同类输出，减少节点数
      if (last && last.type === type && type !== 'cmd' && last.text.length < 20000) {
        return [...es.slice(0, -1), { ...last, text: last.text + text }];
      }
      const next = [...es, { id: seq.current++, type, text }];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  useEffect(() => () => void job.current?.cancel(), []);

  const pushHistory = (cmd: string) => {
    const h = history.current.filter((x) => x !== cmd);
    h.push(cmd);
    history.current = h.slice(-MAX_HISTORY);
    histIdx.current = -1;
    try {
      localStorage.setItem(historyKey, JSON.stringify(history.current));
    } catch {
      /* ignore */
    }
  };

  const exec = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    pushHistory(trimmed);
    if (/^(clear|cls)$/i.test(trimmed)) {
      setEntries([]);
      return;
    }
    append('cmd', trimmed);
    const designFiles = filesForKind(filesRef.current, 'yosys');
    if (!raw && !designFiles.some((f) => f.role === 'design')) {
      append('err', '工程中没有设计源文件。\n');
      return;
    }
    setRunning(true);
    stick.current = true;
    const started = Date.now();
    try {
      const j = await startJob(
        { kind: 'yosys', files: designFiles, options: { script: consoleScript(filesRef.current, topRef.current, trimmed, raw) } },
        {
          onLog: (ev) => append(ev.stream === 'stderr' ? 'err' : ev.stream === 'info' ? 'info' : 'out', ev.text),
        },
      );
      job.current = j;
      const info = await j.done;
      if (job.current === j) job.current = null;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (info.status === 'succeeded') append('info', `\n✓ 完成（${secs} s）\n`);
      else if (info.status === 'cancelled') append('err', `\n已停止\n`);
      else append('err', `\n✗ ${info.error ?? '命令失败'}（${secs} s）\n`);
    } catch (e) {
      append('err', `${(e as Error).message}\n`);
    } finally {
      setRunning(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const h = history.current;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (running) return;
      const v = input;
      setInput('');
      void exec(v);
    } else if (e.key === 'ArrowUp') {
      if (!h.length) return;
      e.preventDefault();
      if (histIdx.current === -1) {
        draft.current = input;
        histIdx.current = h.length - 1;
      } else histIdx.current = Math.max(0, histIdx.current - 1);
      setInput(h[histIdx.current]);
    } else if (e.key === 'ArrowDown') {
      if (histIdx.current === -1) return;
      e.preventDefault();
      if (histIdx.current >= h.length - 1) {
        histIdx.current = -1;
        setInput(draft.current);
      } else {
        histIdx.current++;
        setInput(h[histIdx.current]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setEntries([]);
    } else if (e.key === 'c' && e.ctrlKey && running && !window.getSelection()?.toString()) {
      e.preventDefault();
      void job.current?.cancel();
    }
  };

  return (
    <div className="st-console" onClick={(e) => e.target === e.currentTarget && inputRef.current?.focus()}>
      <div
        className="st-console-out"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        onMouseUp={() => {
          if (!window.getSelection()?.toString()) inputRef.current?.focus();
        }}
      >
        {entries.map((en) => (
          <div key={en.id} className={`st-con-${en.type}`}>
            {en.type === 'cmd' ? (
              <>
                <span className="st-con-prompt">yosys&gt;</span> {en.text}
              </>
            ) : (
              en.text
            )}
          </div>
        ))}
        {running && <div className="st-con-info st-con-running">运行中…</div>}
      </div>
      <div className="st-console-in">
        <ChevronRight size={14} strokeWidth={2} className="st-con-caret" />
        <input
          ref={inputRef}
          className="st-console-input"
          value={input}
          placeholder={running ? '命令运行中…（Ctrl+C 停止）' : raw ? '原始 Yosys 脚本（; 分隔多条命令）' : '输入 Yosys 命令，如 stat'}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setInput(e.target.value);
            histIdx.current = -1;
          }}
          onKeyDown={onKey}
          aria-label="Tcl Console 命令"
        />
        <label className="form-check st-con-raw" title="不自动读入设计文件，只运行输入的脚本">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          原始脚本
        </label>
        {running ? (
          <button className="icon-btn st-icon-sm" title="停止" onClick={() => void job.current?.cancel()}>
            <Square size={12} strokeWidth={2} fill="currentColor" />
          </button>
        ) : (
          <button className="icon-btn st-icon-sm" title="清屏" onClick={() => setEntries([])}>
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
}
