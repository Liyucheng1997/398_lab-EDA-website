// 波形查看器（类 EPWave / GTKWave）。对外只暴露这里的组件与类型。

import { Activity, Download, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parseVcdAsync } from './parseAsync';
import type { VcdData } from './vcd';
import { WaveView } from './WaveView';
import './waveform.css';

export interface WaveformViewerProps {
  /** VCD 文本；null = 还没有波形 */
  vcd: string | null;
  /** 加载中（任务运行中）时显示占位 */
  loading?: boolean;
  /** 初次加载时默认添加的信号（层次名，如 "tb.dut.q"）；缺省时自动添加顶层前若干信号 */
  initialSignals?: string[];
  /** 同一个 key 在重新运行后保留用户已添加的信号列表与缩放 */
  persistKey?: string;
  className?: string;
  /** "下载 VCD" 的文件名，默认 dump.vcd */
  fileName?: string;
}

interface Parsed {
  source: string;
  data: VcdData;
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function WaveformViewer({ vcd, loading, initialSignals, persistKey, className, fileName }: WaveformViewerProps) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;

  useEffect(() => {
    if (vcd === null) {
      setParsing(false);
      setError(null);
      return;
    }
    if (parsedRef.current?.source === vcd) {
      setParsing(false);
      setError(null);
      return;
    }
    if (!vcd.trim()) {
      setParsing(false);
      setParsed(null);
      setError('VCD 文件为空（仿真可能没有调用 $dumpfile / $dumpvars）');
      return;
    }
    setParsing(true);
    setProgress(0);
    setError(null);
    let lastPct = -1;
    const h = parseVcdAsync(vcd, (f) => {
      const pct = Math.floor(f * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        setProgress(f);
      }
    });
    h.promise.then(
      (data) => {
        setParsed({ source: vcd, data });
        setParsing(false);
      },
      (err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setParsed(null);
        setParsing(false);
        setError(`VCD 解析失败：${err instanceof Error ? err.message : String(err)}`);
      },
    );
    return () => h.abort();
  }, [vcd]);

  const rootClass = `wv${className ? ` ${className}` : ''}`;
  const name = fileName || 'dump.vcd';

  // 当前要显示的数据：解析新 VCD 期间、或 vcd 为 null 但仍在仿真时，保留上一次的波形并显示忙碌提示
  const data = parsed && (vcd !== null || loading) ? parsed.data : null;

  if (error && !parsing) {
    return (
      <div className={rootClass}>
        <div className="empty">
          <TriangleAlert size={34} strokeWidth={1.4} className="wv-err-ico" />
          <div>{error}</div>
          {vcd && (
            <button className="btn btn-sm" onClick={() => downloadText(vcd, name)}>
              <Download size={14} strokeWidth={1.75} />
              下载 VCD
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!data) {
    if (parsing) {
      return (
        <div className={rootClass}>
          <div className="empty">
            <div className="spinner" />
            <div>
              正在解析 VCD{vcd ? `（${formatSize(vcd.length)}）` : ''}…{progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}
            </div>
            {progress > 0 && (
              <div className="meter wv-progress">
                <i style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={rootClass}>
          <div className="empty">
            <div className="spinner" />
            <div>仿真中…</div>
          </div>
        </div>
      );
    }
    return (
      <div className={rootClass}>
        <div className="empty">
          <Activity size={34} strokeWidth={1.4} />
          <div>暂无波形，运行仿真后在这里查看</div>
        </div>
      </div>
    );
  }

  if (data.vars.length === 0) {
    return (
      <div className={rootClass}>
        <div className="empty">
          <Activity size={34} strokeWidth={1.4} />
          <div>VCD 中没有可显示的信号{data.truncated ? '（文件不完整）' : ''}</div>
          {vcd && (
            <button className="btn btn-sm" onClick={() => downloadText(vcd, name)}>
              <Download size={14} strokeWidth={1.75} />
              下载 VCD
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <WaveView
        data={data}
        vcdText={vcd ?? parsed?.source ?? null}
        busy={!!loading || parsing}
        busyLabel={parsing ? `正在解析 VCD… ${Math.round(progress * 100)}%` : '仿真中…'}
        persistKey={persistKey}
        initialSignals={initialSignals}
        fileName={name}
      />
    </div>
  );
}
