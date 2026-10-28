import type { ReactNode } from 'react';
import { BarChart3, Clock, Cpu, Download, Gamepad2, Hammer, ListChecks, Play, Waypoints, Zap } from 'lucide-react';
import type { BoardInfo, DeviceInfo, JobStatus, ProjectSettings, UtilizationRow } from '@webeda/shared';
import { StatusDot } from '../../ui/StatusDot';
import type { NavAction } from './FlowNavigator';
import { UtilMeter } from './ReportViews';
import { formatBytes, formatDuration, formatMHz, formatNs, formatRelative, keyRows, type TimingSummary } from './reports';

export interface SummaryRun {
  key: 'simulate' | 'synthesize' | 'implement';
  label: string;
  en: string;
  status: JobStatus | 'idle';
  startedAt?: string;
  durationMs?: number;
  stale: boolean;
}

export interface SummaryViewProps {
  name: string;
  description?: string;
  settings: ProjectSettings;
  device?: DeviceInfo;
  board?: BoardInfo;
  synthUtil: UtilizationRow[] | null;
  implUtil: UtilizationRow[] | null;
  synthStale: boolean;
  implStale: boolean;
  timing: TimingSummary | null;
  timingStale: boolean;
  runs: SummaryRun[];
  bitstream: { url: string; name: string; size?: number; stale: boolean } | null;
  now: number;
  onAction: (a: NavAction | 'openSimulation') => void;
}

function Card({ title, icon, action, children, className }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card st-card ${className ?? ''}`}>
      <header className="st-card-head">
        <span className="st-card-ico">{icon}</span>
        <h3>{title}</h3>
        <span className="spacer" />
        {action}
      </header>
      <div className="st-card-body">{children}</div>
    </section>
  );
}

function Kv({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="st-kv">
      <span>{k}</span>
      <b className={mono ? 'st-mono' : ''}>{v}</b>
    </div>
  );
}

const Stale = () => <span className="st-stale" title="源文件或设置已修改，结果可能过期">已过期</span>;

/** Project Summary：器件、利用率、时序、运行状态、比特流 */
export function SummaryView(p: SummaryViewProps) {
  const { settings, device, board } = p;
  const synthRows = keyRows(p.synthUtil ?? undefined);
  const implRows = keyRows(p.implUtil ?? undefined);
  const pnr = device?.pnr ?? false;

  return (
    <div className="st-summary">
      <div className="st-summary-head">
        <div>
          <div className="st-eyebrow">PROJECT SUMMARY</div>
          <h2>{p.name}</h2>
          {p.description && <p className="st-summary-desc">{p.description}</p>}
        </div>
      </div>
      <div className="st-summary-grid">
        <Card title="器件" icon={<Cpu size={16} strokeWidth={1.75} />} action={<button className="btn btn-sm btn-ghost" onClick={() => p.onAction('settings')}>设置</button>}>
          {device ? (
            <>
              <div className="st-device-name">{device.name}</div>
              <div className="st-device-part st-mono">{device.partNumber}</div>
              <div className="st-tags">
                <span className={`st-tag ${pnr ? 'st-tag-ok' : 'st-tag-warn'}`}>{pnr ? '完整实现' : '仅综合'}</span>
                <span className="st-tag">{device.package}</span>
                <span className="st-tag">{device.constraintExt}</span>
              </div>
            </>
          ) : (
            <div className="muted">未知器件 {settings.device}</div>
          )}
          <div className="st-kvs">
            <Kv k="板卡" v={board ? `${board.name}（${board.vendor}）` : '无'} />
            <Kv k="顶层模块" v={settings.top ?? '自动'} mono />
            <Kv k="仿真顶层" v={settings.simTop ?? '自动'} mono />
            <Kv k="约束文件" v={settings.constraintFile ?? '无'} mono />
            <Kv k="目标频率" v={formatMHz(settings.freqMHz)} />
          </div>
        </Card>

        <Card title="资源利用率" icon={<BarChart3 size={16} strokeWidth={1.75} />} action={<button className="btn btn-sm btn-ghost" onClick={() => p.onAction('reportUtilization')}>完整报告</button>}>
          {!synthRows.length && !implRows.length ? (
            <div className="st-card-empty">
              <span>还没有综合结果</span>
              <button className="btn btn-sm btn-primary" onClick={() => p.onAction('synthesize')}>
                <Hammer size={14} strokeWidth={1.75} />
                运行综合
              </button>
            </div>
          ) : (
            <div className="st-util-stages">
              {[
                { label: '综合后', en: 'Post-Synthesis', rows: synthRows, stale: p.synthStale },
                { label: '实现后', en: 'Post-Implementation', rows: implRows, stale: p.implStale },
              ]
                .filter((s) => s.rows.length)
                .map((s) => (
                  <div key={s.label} className="st-util-stage">
                    <div className="st-util-stage-head">
                      {s.label} <span className="muted">{s.en}</span>
                      {s.stale && <Stale />}
                    </div>
                    {s.rows.map(({ key, row }) => (
                      <div key={key} className="st-util-row">
                        <span className="st-util-key">{key}</span>
                        <span className="st-util-num tabular">
                          {row.used.toLocaleString()}
                          <span className="muted"> / {row.available == null ? '—' : row.available.toLocaleString()}</span>
                        </span>
                        <UtilMeter used={row.used} available={row.available} />
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </Card>

        <Card title="时序" icon={<Clock size={16} strokeWidth={1.75} />} action={pnr ? <button className="btn btn-sm btn-ghost" onClick={() => p.onAction('reportTiming')}>时序报告</button> : undefined}>
          {!pnr ? (
            <div className="st-card-empty">
              <span>{device?.name ?? '该器件'} 暂不支持开源布局布线，无法进行时序分析</span>
            </div>
          ) : p.timing ? (
            <>
              <div className="st-timing-big">
                <div>
                  <span className="st-stat-label">WNS</span>
                  <span className={`st-stat-num ${p.timing.wns < 0 ? 'st-bad' : ''}`}>{formatNs(p.timing.wns, 2)}</span>
                </div>
                <div>
                  <span className="st-stat-label">Fmax</span>
                  <span className="st-stat-num">{formatMHz(p.timing.fmax)}</span>
                </div>
              </div>
              <div className="st-kvs">
                <Kv k="时钟" v={p.timing.clock} mono />
                <Kv k="约束" v={formatMHz(p.timing.constraintMHz)} />
                <Kv
                  k="结果"
                  v={
                    <>
                      <StatusDot status={p.timing.passed ? 'succeeded' : 'failed'} label={p.timing.passed ? '时序满足' : '时序违例'} />
                      {p.timingStale && <Stale />}
                    </>
                  }
                />
              </div>
            </>
          ) : (
            <div className="st-card-empty">
              <span>运行实现后显示时序结果</span>
              <button className="btn btn-sm btn-primary" onClick={() => p.onAction('implement')}>
                <Waypoints size={14} strokeWidth={1.75} />
                运行实现
              </button>
            </div>
          )}
        </Card>

        <Card title="运行状态" icon={<ListChecks size={16} strokeWidth={1.75} />}>
          <div className="st-run-list">
            {p.runs.map((r) => {
              const active = r.status === 'running' || r.status === 'queued';
              const disabled = r.key === 'implement' && !pnr;
              return (
                <div key={r.key} className="st-run-item">
                  <div className="st-run-text">
                    <b>{r.label}</b>
                    <small>{r.en}</small>
                  </div>
                  <div className="st-run-meta">
                    <StatusDot status={disabled ? 'idle' : r.status} label={disabled ? '不支持' : r.status === 'idle' ? '未运行' : undefined} />
                    {r.stale && r.status === 'succeeded' && <Stale />}
                    <small className="muted">
                      {active
                        ? formatDuration(r.startedAt ? p.now - Date.parse(r.startedAt) : undefined)
                        : r.startedAt
                          ? `${formatRelative(r.startedAt, p.now)} · ${formatDuration(r.durationMs)}`
                          : ''}
                    </small>
                  </div>
                  <button
                    className="icon-btn st-icon-sm"
                    title={`运行${r.label}`}
                    disabled={active || disabled}
                    onClick={() => p.onAction(r.key === 'simulate' ? 'simulate' : r.key)}
                  >
                    <Play size={14} strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="比特流" icon={<Zap size={16} strokeWidth={1.75} />}>
          {!pnr ? (
            <div className="st-card-empty">
              <span>该器件只支持综合，不能生成比特流</span>
            </div>
          ) : p.bitstream ? (
            <div className="st-bit">
              <div className="st-bit-name st-mono">
                {p.bitstream.name}
                {p.bitstream.size != null && <span className="muted"> · {formatBytes(p.bitstream.size)}</span>}
                {p.bitstream.stale && <Stale />}
              </div>
              <div className="st-bit-actions">
                <a className="btn btn-sm btn-primary" href={p.bitstream.url} download={p.bitstream.name}>
                  <Download size={14} strokeWidth={1.75} />
                  下载比特流
                </a>
                <button className="btn btn-sm" onClick={() => p.onAction('virtualBoard')}>
                  <Gamepad2 size={14} strokeWidth={1.75} />
                  虚拟开发板
                </button>
              </div>
            </div>
          ) : (
            <div className="st-card-empty">
              <span>还没有比特流</span>
              <button className="btn btn-sm btn-primary" onClick={() => p.onAction('bitstream')}>
                <Zap size={14} strokeWidth={1.75} />
                生成比特流
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
