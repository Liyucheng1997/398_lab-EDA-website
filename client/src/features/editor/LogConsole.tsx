import { useEffect, useMemo, useRef } from 'react';
import type { Diagnostic } from '@webeda/shared';
import type { LogLine } from '../../lib/useJob';

interface Props {
  logs: LogLine[];
  /** 点击日志中的 "file:line" 时回调（跳转到源码） */
  onJump?: (file: string, line: number) => void;
  /** 已知的源文件名，用来识别可点击位置 */
  files?: string[];
  emptyText?: string;
}

const LOC_RE = /([\w\-./]+\.(?:sv|v|vh|svh|pcf|lpf|xdc)):(\d+)/g;

/** 任务日志面板：等宽字体、stderr 标红、info 灰色、错误/警告行高亮、文件位置可点击、自动滚到底 */
export function LogConsole({ logs, onJump, files, emptyText = '运行后在这里查看输出' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const lines = useMemo(() => {
    const out: { stream: LogLine['stream']; text: string }[] = [];
    let buf = '';
    let stream: LogLine['stream'] = 'stdout';
    for (const l of logs) {
      if (l.stream !== stream && buf) {
        out.push(...buf.split('\n').map((t) => ({ stream, text: t })));
        buf = '';
      }
      stream = l.stream;
      buf += l.text;
      const idx = buf.lastIndexOf('\n');
      if (idx >= 0) {
        out.push(...buf.slice(0, idx).split('\n').map((t) => ({ stream, text: t })));
        buf = buf.slice(idx + 1);
      }
    }
    if (buf) out.push({ stream, text: buf });
    return out;
  }, [logs]);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const known = useMemo(() => new Set(files ?? []), [files]);

  const render = (text: string) => {
    if (!onJump) return text;
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(LOC_RE)) {
      const file = m[1].replace(/^\.\//, '');
      if (known.size && !known.has(file)) continue;
      parts.push(text.slice(last, m.index));
      parts.push(
        <a key={m.index} className="log-loc" onClick={() => onJump(file, Number(m[2]))}>
          {m[0]}
        </a>,
      );
      last = m.index! + m[0].length;
    }
    parts.push(text.slice(last));
    return parts;
  };

  return (
    <div
      className="log-console"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {lines.length === 0 ? (
        <div className="log-empty">{emptyText}</div>
      ) : (
        lines.map((l, i) => {
          const lower = l.text.toLowerCase();
          const cls =
            l.stream === 'info'
              ? 'log-info'
              : /\berror\b|错误|fatal|failed/.test(lower)
                ? 'log-error'
                : /\bwarning\b|警告/.test(lower)
                  ? 'log-warn'
                  : l.stream === 'stderr'
                    ? 'log-stderr'
                    : '';
          return (
            <div key={i} className={`log-line ${cls}`}>
              {render(l.text) || ' '}
            </div>
          );
        })
      )}
    </div>
  );
}

/** 诊断列表（类 Vivado Messages 面板） */
export function DiagnosticList({ diagnostics, onJump }: { diagnostics: Diagnostic[]; onJump?: (file: string, line: number) => void }) {
  if (!diagnostics.length) return <div className="log-empty">没有消息</div>;
  return (
    <div className="diag-list">
      {diagnostics.map((d, i) => (
        <div
          key={i}
          className={`diag diag-${d.severity}${d.file && d.line ? ' diag-link' : ''}`}
          onClick={() => d.file && d.line && onJump?.(d.file, d.line)}
        >
          <span className="diag-sev">{d.severity === 'error' ? '错误' : d.severity === 'warning' ? '警告' : '信息'}</span>
          <span className="diag-tool">[{d.tool}]</span>
          <span className="diag-msg">{d.message}</span>
          {d.file && (
            <span className="diag-loc">
              {d.file}
              {d.line ? `:${d.line}` : ''}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
