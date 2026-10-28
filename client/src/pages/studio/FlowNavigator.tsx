import { useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  ChevronDown,
  CircuitBoard,
  Clock,
  Download,
  FilePlus2,
  Gamepad2,
  Grid3x3,
  Hammer,
  Network,
  Play,
  Settings,
  Waypoints,
  Zap,
} from 'lucide-react';
import type { JobStatus } from '@webeda/shared';
import { StatusDot } from '../../ui/StatusDot';

export type NavAction =
  | 'settings'
  | 'addSources'
  | 'simulate'
  | 'openElaborated'
  | 'synthesize'
  | 'openSynthesized'
  | 'reportUtilization'
  | 'implement'
  | 'openImplemented'
  | 'reportTiming'
  | 'bitstream'
  | 'downloadBitstream'
  | 'virtualBoard';

type Status = JobStatus | 'idle';

export interface FlowNavigatorProps {
  status: { simulate: Status; elaborate: Status; synthesize: Status; implement: Status; bitstream: Status; gatesim: Status };
  /** 器件支持布局布线 */
  pnr: boolean;
  hasBitstream: boolean;
  onAction: (a: NavAction) => void;
}

interface Item {
  action: NavAction;
  label: string;
  en: string;
  icon: ReactNode;
  status?: Status;
  disabled?: boolean;
  tip?: string;
}

const STORAGE_KEY = 'webeda.studio.nav.collapsed';

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

const ic = (C: typeof Play) => <C size={15} strokeWidth={1.75} />;

/** 类 Vivado Flow Navigator：按流程阶段分组的操作入口 */
export function FlowNavigator({ status, pnr, hasBitstream, onAction }: FlowNavigatorProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const toggle = (k: string) =>
    setCollapsed((c) => {
      const next = { ...c, [k]: !c[k] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const noPnr = '当前器件仅支持综合（开源工具链暂不支持其布局布线）';
  const sections: { key: string; label: string; en: string; items: Item[] }[] = [
    {
      key: 'pm',
      label: '工程管理',
      en: 'PROJECT MANAGER',
      items: [
        { action: 'settings', label: '设置', en: 'Settings', icon: ic(Settings) },
        { action: 'addSources', label: '添加源文件', en: 'Add Sources', icon: ic(FilePlus2) },
      ],
    },
    {
      key: 'sim',
      label: '仿真',
      en: 'SIMULATION',
      items: [{ action: 'simulate', label: '运行行为仿真', en: 'Run Behavioral Simulation', icon: ic(Play), status: status.simulate }],
    },
    {
      key: 'rtl',
      label: 'RTL 分析',
      en: 'RTL ANALYSIS',
      items: [{ action: 'openElaborated', label: '打开 RTL 设计', en: 'Open Elaborated Design', icon: ic(Network), status: status.elaborate }],
    },
    {
      key: 'synth',
      label: '综合',
      en: 'SYNTHESIS',
      items: [
        { action: 'synthesize', label: '运行综合', en: 'Run Synthesis', icon: ic(Hammer), status: status.synthesize },
        { action: 'openSynthesized', label: '打开综合后设计', en: 'Open Synthesized Design', icon: ic(CircuitBoard) },
        { action: 'reportUtilization', label: '资源利用率报告', en: 'Report Utilization', icon: ic(BarChart3) },
      ],
    },
    {
      key: 'impl',
      label: '实现',
      en: 'IMPLEMENTATION',
      items: [
        { action: 'implement', label: '运行实现', en: 'Run Implementation', icon: ic(Waypoints), status: status.implement, disabled: !pnr, tip: pnr ? undefined : noPnr },
        { action: 'openImplemented', label: '打开实现后设计', en: 'Open Implemented Design', icon: ic(Grid3x3), disabled: !pnr, tip: pnr ? undefined : noPnr },
        { action: 'reportTiming', label: '时序报告', en: 'Report Timing', icon: ic(Clock), disabled: !pnr, tip: pnr ? undefined : noPnr },
      ],
    },
    {
      key: 'prog',
      label: '编程与调试',
      en: 'PROGRAM AND DEBUG',
      items: [
        { action: 'bitstream', label: '生成比特流', en: 'Generate Bitstream', icon: ic(Zap), status: status.bitstream, disabled: !pnr, tip: pnr ? undefined : noPnr },
        {
          action: 'downloadBitstream',
          label: '下载比特流',
          en: 'Download Bitstream',
          icon: ic(Download),
          disabled: !hasBitstream,
          tip: hasBitstream ? undefined : '还没有生成比特流',
        },
        { action: 'virtualBoard', label: '虚拟开发板', en: 'Virtual Board', icon: ic(Gamepad2), status: status.gatesim },
      ],
    },
  ];

  return (
    <nav className="st-nav" aria-label="Flow Navigator">
      {sections.map((s) => (
        <div key={s.key} className="st-nav-sec">
          <button className="st-nav-head" onClick={() => toggle(s.key)} aria-expanded={!collapsed[s.key]}>
            <ChevronDown size={13} strokeWidth={2} className={`st-chev${collapsed[s.key] ? ' st-chev-closed' : ''}`} />
            <span className="st-nav-head-label">{s.label}</span>
            <span className="st-nav-head-en">{s.en}</span>
          </button>
          {!collapsed[s.key] &&
            s.items.map((it) => (
              <button
                key={it.action}
                className="st-nav-item"
                disabled={it.disabled}
                title={it.tip ?? `${it.label}（${it.en}）`}
                onClick={() => onAction(it.action)}
              >
                <span className="st-nav-ico">{it.icon}</span>
                <span className="st-nav-text">
                  <span>{it.label}</span>
                  <small>{it.en}</small>
                </span>
                {it.status && it.status !== 'idle' && <StatusDot status={it.status} label="" />}
              </button>
            ))}
        </div>
      ))}
      <div className="st-nav-foot">
        <Activity size={12} strokeWidth={1.75} />
        <span>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 综合
        </span>
      </div>
    </nav>
  );
}
