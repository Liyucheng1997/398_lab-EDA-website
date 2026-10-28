import { useEffect, useState } from 'react';
import { Gauge, Hammer, Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import type { SimSpeed } from '../sim/protocol';
import { SLIDER_STEPS, formatCount, formatHz, formatSimTime, hzToSlider, sliderToHz } from '../display';

const STEP_CHOICES = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000];
const ICON = { size: 16, strokeWidth: 1.75 };

export interface ToolbarProps {
  running: boolean;
  stepping: boolean;
  disabled: boolean;
  speed: SimSpeed;
  achievedHz: number;
  cycles: number;
  freqMHz: number;
  onFreqMHz: (mhz: number) => void;
  onToggle: () => void;
  onStep: (n: number) => void;
  onReset: () => void;
  onSpeed: (s: SimSpeed) => void;
  onBuild?: () => void;
  building?: boolean;
  hasClock: boolean;
}

export function Toolbar(p: ToolbarProps) {
  const [stepN, setStepN] = useState(1);
  const [freqText, setFreqText] = useState(String(p.freqMHz));
  useEffect(() => setFreqText(String(p.freqMHz)), [p.freqMHz]);
  const commitFreq = () => {
    const v = Number(freqText);
    if (Number.isFinite(v) && v > 0 && v <= 10_000) p.onFreqMHz(v);
    else setFreqText(String(p.freqMHz));
  };
  const freqHz = p.freqMHz * 1e6;
  const simTime = p.cycles / freqHz;
  const ratio = p.running && p.achievedHz > 0 ? p.achievedHz / freqHz : 0;
  const isMax = p.speed === 'max';
  const sliderVal = isMax ? SLIDER_STEPS : hzToSlider(p.speed as number);

  return (
    <div className="vb-toolbar card">
      <div className="vb-tb-group">
        <button type="button" className="btn btn-primary vb-run" onClick={p.onToggle} disabled={p.disabled} title={p.running ? '暂停仿真' : '运行仿真'}>
          {p.running ? <Pause {...ICON} /> : <Play {...ICON} />}
          {p.running ? (p.stepping ? '单步中' : '暂停') : '运行'}
        </button>
        <div className="vb-step">
          <button type="button" className="btn btn-sm" onClick={() => p.onStep(stepN)} disabled={p.disabled} title={`推进 ${stepN} 个时钟周期`}>
            <StepForward {...ICON} size={14} />
            单步
          </button>
          <select className="input vb-step-n" value={stepN} onChange={(e) => setStepN(Number(e.target.value))} aria-label="单步周期数" disabled={p.disabled}>
            {STEP_CHOICES.map((n) => (
              <option key={n} value={n}>
                ×{formatCount(n)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-sm" onClick={p.onReset} disabled={p.disabled} title="重新上电：寄存器回到初值，周期计数清零（开关位置保留）">
          <RotateCcw {...ICON} size={14} />
          上电复位
        </button>
      </div>

      <span className="tb-sep vb-tb-sep" />

      <div className="vb-tb-group vb-speed">
        <Gauge {...ICON} className="ico vb-muted-ico" aria-hidden />
        <input
          type="range"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={sliderVal}
          disabled={p.disabled}
          aria-label="目标仿真速度（对数刻度）"
          onChange={(e) => p.onSpeed(sliderToHz(Number(e.target.value)))}
        />
        <span className="vb-speed-val tabular">{isMax ? '不限速' : formatHz(p.speed as number)}</span>
        <button type="button" className={`chip${isMax ? ' active' : ''}`} onClick={() => p.onSpeed(isMax ? Math.min(freqHz, 1e6) : 'max')} disabled={p.disabled} title="不限速，尽可能快地仿真">
          最快
        </button>
      </div>

      <span className="tb-sep vb-tb-sep" />

      <div className="vb-tb-group vb-stats">
        <div className="vb-stat" title="实测仿真速度（时钟周期/秒）">
          <small>实测</small>
          <b className="tabular">{p.running ? formatHz(p.achievedHz) : '—'}</b>
        </div>
        <div className="vb-stat" title={`相对设计时钟 ${p.freqMHz} MHz 的实时比例`}>
          <small>实时比</small>
          <b className="tabular">{ratio > 0 ? (ratio >= 0.1 ? `${ratio.toFixed(2)}×` : `${ratio.toExponential(1)}×`) : '—'}</b>
        </div>
        <div className="vb-stat" title={`${p.cycles.toLocaleString()} 个时钟周期`}>
          <small>周期</small>
          <b className="tabular">{formatCount(p.cycles)}</b>
        </div>
        <div className="vb-stat" title="仿真时间 = 周期数 / 设计时钟频率">
          <small>仿真时间</small>
          <b className="tabular">{p.hasClock ? formatSimTime(simTime) : '—'}</b>
        </div>
      </div>

      <div className="vb-tb-spacer" />

      <label className="vb-freq" title="设计时钟频率：用于串口波特率换算与仿真时间显示">
        <span>设计时钟</span>
        <input
          className="input"
          inputMode="decimal"
          value={freqText}
          onChange={(e) => setFreqText(e.target.value)}
          onBlur={commitFreq}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setFreqText(String(p.freqMHz));
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="设计时钟频率 MHz"
        />
        <span>MHz</span>
      </label>

      {p.onBuild && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={p.onBuild} disabled={p.building} title="重新综合并加载门级网表">
          {p.building ? <span className="spinner vb-spinner-sm" /> : <Hammer {...ICON} size={14} />}
          {p.building ? '构建中…' : '重新构建'}
        </button>
      )}
    </div>
  );
}
