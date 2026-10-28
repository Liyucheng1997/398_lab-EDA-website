/**
 * nextpnr --report report.json → TimingReport
 */
import type { ClockTiming, TimingPathStep, TimingReport } from '@webeda/shared';

interface ReportEndpoint {
  cell?: string;
  port?: string;
  loc?: number[];
}

interface ReportStep {
  delay?: number;
  from?: ReportEndpoint;
  to?: ReportEndpoint;
  type?: string;
  net?: string;
  sources?: string[];
}

export interface NextpnrReport {
  fmax?: Record<string, { achieved?: number; constraint?: number }>;
  critical_paths?: { from?: string; to?: string; path?: ReportStep[] }[];
  utilization?: Record<string, { used: number; available: number }>;
}

const round = (v: number, d: number) => {
  const p = 10 ** d;
  return Math.round(v * p) / p;
};

/** nextpnr 的时钟网名 → 用户可读名："clk$SB_IO_IN_$glb_clk" → "clk"，"$glbnet$clk$TRELLIS_IO_IN" → "clk" */
export function prettyClockName(name: string): string {
  let s = name.replace(/^\$glbnet\$/, '');
  const i = s.indexOf('$');
  if (i > 0) s = s.slice(0, i);
  return s || name;
}

function endpoint(e: ReportEndpoint | undefined): string {
  if (!e) return '?';
  const cell = e.cell ?? '?';
  return e.port ? `${cell}.${e.port}` : cell;
}

/** 只保留指向用户源码的位置（去掉 /share/… 单元库） */
function userSource(sources: string[] | undefined): string | undefined {
  if (!sources?.length) return undefined;
  const user = sources.filter((s) => s && !s.startsWith('/share/') && !s.startsWith('share/'));
  return user.length ? user.join(', ') : undefined;
}

export function parseTimingReport(report: NextpnrReport | undefined, defaultFreqMHz: number): TimingReport {
  const clocks: ClockTiming[] = [];
  const used = new Map<string, number>();
  for (const [raw, v] of Object.entries(report?.fmax ?? {})) {
    const achieved = typeof v?.achieved === 'number' && Number.isFinite(v.achieved) ? v.achieved : 0;
    const constraint = typeof v?.constraint === 'number' && v.constraint > 0 ? v.constraint : defaultFreqMHz;
    let clock = prettyClockName(raw);
    const n = used.get(clock) ?? 0;
    used.set(clock, n + 1);
    if (n > 0) clock = `${clock} (${raw})`;
    const slack = achieved > 0 ? 1000 / constraint - 1000 / achieved : -Infinity;
    clocks.push({
      clock,
      achievedMHz: round(achieved, 2),
      constraintMHz: round(constraint, 3),
      slackNs: Number.isFinite(slack) ? round(slack, 3) : -round(1000 / constraint, 3),
      passed: achieved >= constraint,
    });
  }
  clocks.sort((a, b) => a.slackNs - b.slackNs);

  const paths = (report?.critical_paths ?? [])
    .filter((p) => Array.isArray(p?.path) && p.path.length > 0)
    .map((p) => {
      const stepsRaw = p.path!;
      const steps: TimingPathStep[] = stepsRaw.slice(0, 500).map((s) => {
        const step: TimingPathStep = {
          from: endpoint(s.from),
          to: endpoint(s.to),
          type: s.type ?? 'unknown',
          delayNs: round(typeof s.delay === 'number' ? s.delay : 0, 3),
        };
        if (s.net) step.net = s.net;
        const src = userSource(s.sources);
        if (src) step.source = src;
        return step;
      });
      const total = stepsRaw.reduce((acc, s) => acc + (typeof s.delay === 'number' ? s.delay : 0), 0);
      return {
        from: endpoint(stepsRaw[0].from),
        to: endpoint(stepsRaw[stepsRaw.length - 1].to),
        totalDelayNs: round(total, 3),
        steps,
      };
    })
    .sort((a, b) => b.totalDelayNs - a.totalDelayNs)
    .slice(0, 5);

  return { clocks, criticalPaths: paths };
}
