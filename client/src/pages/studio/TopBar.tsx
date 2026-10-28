import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, Hammer, Moon, PanelLeft, Play, Settings, Square, Sun, Waypoints, Zap } from 'lucide-react';
import type { DeviceInfo } from '@webeda/shared';
import { useTheme } from '../../lib/theme';
import type { SaveState } from './useProjectDoc';

export interface TopBarProps {
  name: string;
  onRename: (name: string) => void;
  device?: DeviceInfo;
  saveState: SaveState;
  saveError: string | null;
  onSave: () => void;
  running: { simulate: boolean; synthesize: boolean; implement: boolean; bitstream: boolean };
  anyRunning: boolean;
  onSimulate: () => void;
  onSynthesize: () => void;
  onImplement: () => void;
  onBitstream: () => void;
  onStop: () => void;
  onSettings: () => void;
  navOpen: boolean;
  onToggleNav: () => void;
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中…',
  error: '保存失败',
};

export function TopBar(p: TopBarProps) {
  const [theme, setTheme] = useTheme();
  const [draft, setDraft] = useState(p.name);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setDraft(p.name);
  }, [p.name, editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== p.name) p.onRename(v.slice(0, 200));
    else setDraft(p.name);
  };

  const pnr = p.device?.pnr ?? false;
  const noPnrTip = p.device ? `${p.device.name} 暂不支持开源布局布线，只能综合与资源估算` : '';

  return (
    <header className="topbar st-topbar">
      <button className={`icon-btn${p.navOpen ? ' active' : ''}`} onClick={p.onToggleNav} title="显示/隐藏 Flow Navigator (Ctrl+B)" aria-label="切换导航">
        <PanelLeft size={17} strokeWidth={1.75} />
      </button>
      <Link to="/studio" className="logo st-logo" title="返回工程列表">
        <span className="logo-mark">W</span>
        <span className="logo-text">
          <b>Studio</b>
          <small>FPGA 工程</small>
        </span>
      </Link>
      <span className="tb-sep st-hide-sm" />
      <input
        ref={inputRef}
        className="st-name-input"
        value={draft}
        aria-label="工程名称"
        title="点击修改工程名称"
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') inputRef.current?.blur();
          if (e.key === 'Escape') {
            setDraft(p.name);
            setEditing(false);
            requestAnimationFrame(() => inputRef.current?.blur());
          }
        }}
      />
      {p.device && (
        <span className="st-chip st-hide-sm" title={`${p.device.name} · ${p.device.package}${p.device.pnr ? '' : '（仅综合）'}`}>
          <Cpu size={13} strokeWidth={1.75} />
          {p.device.partNumber}
        </span>
      )}
      <button
        className={`st-save st-save-${p.saveState}`}
        onClick={p.onSave}
        title={p.saveState === 'error' ? `保存失败：${p.saveError ?? ''}（点击重试）` : '保存 (Ctrl+S)'}
      >
        <i />
        <span className="st-hide-sm">{SAVE_LABEL[p.saveState]}</span>
      </button>
      <span className="spacer" />
      <div className="st-actions">
        <button className="btn btn-sm" onClick={p.onSimulate} disabled={p.running.simulate} title="运行行为仿真 (Alt+Enter)">
          <Play size={14} strokeWidth={1.75} />
          <span className="st-btn-label">运行仿真</span>
        </button>
        <button className="btn btn-sm" onClick={p.onSynthesize} disabled={p.running.synthesize} title="运行综合 (Ctrl+Enter)">
          <Hammer size={14} strokeWidth={1.75} />
          <span className="st-btn-label">运行综合</span>
        </button>
        <span className="st-tip-wrap" title={pnr ? '运行实现 (Ctrl+Shift+Enter)' : noPnrTip}>
          <button className="btn btn-sm" onClick={p.onImplement} disabled={!pnr || p.running.implement}>
            <Waypoints size={14} strokeWidth={1.75} />
            <span className="st-btn-label">运行实现</span>
          </button>
        </span>
        <span className="st-tip-wrap" title={pnr ? '生成比特流 (Ctrl+Shift+B)' : noPnrTip}>
          <button className="btn btn-sm btn-primary" onClick={p.onBitstream} disabled={!pnr || p.running.bitstream}>
            <Zap size={14} strokeWidth={1.75} />
            <span className="st-btn-label">生成比特流</span>
          </button>
        </span>
        {p.anyRunning && (
          <button className="btn btn-sm st-stop" onClick={p.onStop} title="停止所有运行中的任务">
            <Square size={12} strokeWidth={2} fill="currentColor" />
            <span className="st-btn-label">停止</span>
          </button>
        )}
      </div>
      <span className="tb-sep st-hide-sm" />
      <button className="icon-btn st-hide-sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="切换深色模式" aria-label="切换主题">
        {theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
      </button>
      <button className="icon-btn" onClick={p.onSettings} title="工程设置" aria-label="工程设置">
        <Settings size={17} strokeWidth={1.75} />
      </button>
    </header>
  );
}
