import { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Clock, ListChecks, MessageSquare } from 'lucide-react';
import type { Diagnostic, RunRecord, TimingReport, UtilizationReport, UtilizationRow } from '@webeda/shared';
import { DiagnosticList } from '../../features/editor/LogConsole';
import { StatusDot } from '../../ui/StatusDot';
import {
  countDiagnostics,
  formatDateTime,
  formatDuration,
  formatMHz,
  formatNs,
  formatPercent,
  meterClass,
  meterWidth,
  RUN_PREFIX,
  sortedCells,
  sortRuns,
  sortUtilRows,
  utilPercent,
} from './reports';

/** 利用率进度条 + 百分比 */
export function UtilMeter({ used, available }: { used: number; available: number | null }) {
  const p = utilPercent(used, available);
  return (
    <span className="st-meter-cell">
      <span className={`meter ${meterClass(p)}`}>
        <i style={{ width: `${meterWidth(p)}%` }} />
      </span>
      <span className={`st-pct st-pct-${meterClass(p) || 'ok'}`}>{formatPercent(p)}</span>
    </span>
  );
}

export function UtilRowsTable({ rows }: { rows: UtilizationRow[] }) {
  const sorted = useMemo(() => sortUtilRows(rows), [rows]);
  return (
    <table className="table st-util-table">
      <thead>
        <tr>
          <th>资源</th>
          <th className="num">已用</th>
          <th className="num">可用</th>
          <th>利用率</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.resource}>
            <td className="st-mono">{r.resource}</td>
            <td className="num">{r.used.toLocaleString()}</td>
            <td className="num">{r.available == null ? '—' : r.available.toLocaleString()}</td>
            <td>
              <UtilMeter used={r.used} available={r.available} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 完整资源利用率报告：资源表 + 单元类型计数 + 模块计数 */
export function UtilizationReportView({ report, label }: { report: UtilizationReport | null; label?: string }) {
  const cells = useMemo(() => sortedCells(report ?? undefined), [report]);
  if (!report) {
    return (
      <div className="empty">
        <BarChart3 size={34} strokeWidth={1.4} />
        <span>运行综合或实现后显示资源利用率</span>
      </div>
    );
  }
  const totalCells = cells.reduce((n, c) => n + c.count, 0);
  const modules = Object.entries(report.modules ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="st-report">
      {label && <div className="st-report-title">{label}</div>}
      {report.rows.length ? <UtilRowsTable rows={report.rows} /> : <div className="log-empty">没有资源数据</div>}
      <div className="st-report-title">
        单元类型 <span className="muted">（共 {totalCells.toLocaleString()} 个）</span>
      </div>
      {cells.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>单元类型</th>
              <th className="num">数量</th>
              <th className="num">占比</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.type}>
                <td className="st-mono">{c.type}</td>
                <td className="num">{c.count.toLocaleString()}</td>
                <td className="num">{formatPercent(utilPercent(c.count, totalCells))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="log-empty">没有单元</div>
      )}
      {modules.length > 0 && (
        <>
          <div className="st-report-title">模块</div>
          <table className="table">
            <thead>
              <tr>
                <th>模块</th>
                <th className="num">单元数</th>
              </tr>
            </thead>
            <tbody>
              {modules.map(([m, n]) => (
                <tr key={m}>
                  <td className="st-mono">{m}</td>
                  <td className="num">{n.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const SOURCE_RE = /^(.+?):(\d+)(?:\.\d+)?/;

/** 时序报告：时钟汇总 + 关键路径 */
export function TimingReportView({ timing, onJump }: { timing: TimingReport | null; onJump?: (file: string, line: number) => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  if (!timing) {
    return (
      <div className="empty">
        <Clock size={34} strokeWidth={1.4} />
        <span>运行实现后显示时序报告</span>
      </div>
    );
  }
  return (
    <div className="st-report">
      <div className="st-report-title">时钟</div>
      {timing.clocks.length ? (
        <table className="table">
          <thead>
            <tr>
              <th>时钟</th>
              <th className="num">约束</th>
              <th className="num">Fmax</th>
              <th className="num">WNS</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {timing.clocks.map((c) => (
              <tr key={c.clock}>
                <td className="st-mono">{c.clock}</td>
                <td className="num">{formatMHz(c.constraintMHz)}</td>
                <td className="num">{formatMHz(c.achievedMHz)}</td>
                <td className={`num ${c.slackNs < 0 ? 'st-bad' : ''}`}>{formatNs(c.slackNs)}</td>
                <td>
                  <StatusDot status={c.passed ? 'succeeded' : 'failed'} label={c.passed ? '满足' : '违例'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="log-empty">设计中没有时钟域（纯组合逻辑或时钟未被识别）</div>
      )}
      <div className="st-report-title">关键路径</div>
      {timing.criticalPaths.length === 0 && <div className="log-empty">没有关键路径</div>}
      {timing.criticalPaths.map((p, i) => {
        let acc = 0;
        return (
          <div key={i} className="st-path">
            <button className="st-path-head" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
              <ChevronDown size={13} strokeWidth={2} className={`st-chev${open[i] ? '' : ' st-chev-closed'}`} />
              <span className="st-path-idx">#{i + 1}</span>
              <span className="st-mono st-ellipsis">{p.from}</span>
              <span className="muted">→</span>
              <span className="st-mono st-ellipsis">{p.to}</span>
              <span className="spacer" />
              <b className="tabular">{formatNs(p.totalDelayNs)}</b>
            </button>
            {open[i] && (
              <div className="st-table-scroll">
                <table className="table st-path-table">
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>从</th>
                      <th>到</th>
                      <th className="num">延迟</th>
                      <th className="num">累计</th>
                      <th>线网 / 源码</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.steps.map((s, j) => {
                      acc += s.delayNs;
                      const m = s.source ? SOURCE_RE.exec(s.source) : null;
                      return (
                        <tr key={j}>
                          <td>{s.type}</td>
                          <td className="st-mono st-ellipsis" title={s.from}>
                            {s.from}
                          </td>
                          <td className="st-mono st-ellipsis" title={s.to}>
                            {s.to}
                          </td>
                          <td className="num">{s.delayNs.toFixed(3)}</td>
                          <td className="num">{acc.toFixed(3)}</td>
                          <td className="st-mono st-ellipsis" title={[s.net, s.source].filter(Boolean).join('\n')}>
                            {m && onJump ? (
                              <a className="log-loc" onClick={() => onJump(m[1], Number(m[2]))}>
                                {s.source}
                              </a>
                            ) : (
                              s.net ?? s.source ?? ''
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const RUN_LABEL: Record<RunRecord['kind'], string> = { synthesize: '综合', implement: '实现', simulate: '仿真' };

const num = (v: string | number | undefined) => (v == null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString() : v);

/** Design Runs 表（类 Vivado） */
export function RunsTable({ runs, now }: { runs: RunRecord[]; now: number }) {
  const sorted = useMemo(() => sortRuns(runs), [runs]);
  if (!runs.length) {
    return (
      <div className="empty">
        <ListChecks size={34} strokeWidth={1.4} />
        <span>还没有运行记录</span>
      </div>
    );
  }
  return (
    <div className="st-table-scroll">
      <table className="table st-runs-table">
        <thead>
          <tr>
            <th>运行</th>
            <th>类型</th>
            <th>状态</th>
            <th className="num">WNS</th>
            <th className="num">Fmax</th>
            <th className="num">LUT</th>
            <th className="num">FF</th>
            <th className="num">BRAM</th>
            <th className="num">DSP</th>
            <th className="num">IO</th>
            <th>开始时间</th>
            <th className="num">耗时</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const s = r.summary ?? {};
            const active = r.status === 'running' || r.status === 'queued';
            const elapsed = active ? now - Date.parse(r.startedAt) : r.durationMs;
            const wns = typeof s.WNS === 'number' ? s.WNS : undefined;
            return (
              <tr key={`${r.id}-${r.jobId}`}>
                <td className="st-mono">
                  <b>{r.id || `${RUN_PREFIX[r.kind]}_?`}</b>
                </td>
                <td>{RUN_LABEL[r.kind] ?? r.kind}</td>
                <td>
                  <StatusDot status={r.status} />
                </td>
                <td className={`num ${wns != null && wns < 0 ? 'st-bad' : ''}`}>{wns != null ? `${wns.toFixed(3)} ns` : '—'}</td>
                <td className="num">{typeof s.Fmax === 'number' ? formatMHz(s.Fmax) : '—'}</td>
                <td className="num">{num(s.LUT)}</td>
                <td className="num">{num(s.FF)}</td>
                <td className="num">{num(s.BRAM)}</td>
                <td className="num">{num(s.DSP)}</td>
                <td className="num">{num(s.IO)}</td>
                <td className="tabular">{formatDateTime(r.startedAt)}</td>
                <td className="num">{formatDuration(elapsed)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface MessageGroup {
  key: string;
  label: string;
  diagnostics: Diagnostic[];
}

/** Messages：按阶段分组，带错误/警告计数与筛选 */
export function MessagesView({ groups, onJump }: { groups: MessageGroup[]; onJump: (file: string, line: number) => void }) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const nonEmpty = groups.filter((g) => g.diagnostics.length);
  const total = countDiagnostics(nonEmpty.flatMap((g) => g.diagnostics));
  if (!nonEmpty.length) {
    return (
      <div className="empty">
        <MessageSquare size={34} strokeWidth={1.4} />
        <span>没有消息</span>
      </div>
    );
  }
  return (
    <div className="st-messages">
      <div className="st-messages-bar">
        <div className="seg st-seg-sm">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部
          </button>
          <button className={filter === 'error' ? 'active' : ''} onClick={() => setFilter('error')}>
            错误 {total.errors}
          </button>
          <button className={filter === 'warning' ? 'active' : ''} onClick={() => setFilter('warning')}>
            警告 {total.warnings}
          </button>
        </div>
      </div>
      {nonEmpty.map((g) => {
        const c = countDiagnostics(g.diagnostics);
        const list = filter === 'all' ? g.diagnostics : g.diagnostics.filter((d) => d.severity === filter);
        return (
          <div key={g.key} className="st-msg-group">
            <button className="st-msg-head" onClick={() => setClosed((s) => ({ ...s, [g.key]: !s[g.key] }))}>
              <ChevronDown size={13} strokeWidth={2} className={`st-chev${closed[g.key] ? ' st-chev-closed' : ''}`} />
              <span>{g.label}</span>
              {c.errors > 0 && <span className="badge badge-danger">{c.errors}</span>}
              {c.warnings > 0 && <span className="badge badge-warning">{c.warnings}</span>}
              {c.infos > 0 && <span className="badge">{c.infos}</span>}
            </button>
            {!closed[g.key] && (list.length ? <DiagnosticList diagnostics={list} onJump={onJump} /> : <div className="st-group-empty">没有匹配的消息</div>)}
          </div>
        );
      })}
    </div>
  );
}
