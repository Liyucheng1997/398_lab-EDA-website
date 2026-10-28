import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Cpu, FileText, Languages, Network, Settings2 } from 'lucide-react';
import type { PlaygroundSettings, SimulateOptions, ToolInfo } from '@webeda/shared';
import { clampTimeout, DESCRIPTION_MAX, MAX_TIMEOUT, STANDARDS, type Standard } from './model';

interface Props {
  settings: PlaygroundSettings;
  description: string;
  tools: ToolInfo[] | null;
  toolsError: boolean;
  elaborating: boolean;
  onSimulate: (patch: Partial<SimulateOptions>) => void;
  onSettings: (patch: Partial<Omit<PlaygroundSettings, 'simulate'>>) => void;
  onDescription: (value: string) => void;
  onElaborate: () => void;
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="pg-side-sec">
      <div className="pg-side-title">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

/** 左侧设置栏（macOS 侧栏风格） */
export function Sidebar({ settings, description, tools, toolsError, elaborating, onSimulate, onSettings, onDescription, onElaborate }: Props) {
  const sim = settings.simulate;
  const iverilog = tools?.find((t) => t.id === 'iverilog');
  const yosys = tools?.find((t) => t.id === 'yosys');
  const [timeout, setTimeoutText] = useState(String(sim.timeoutSec ?? 30));
  useEffect(() => setTimeoutText(String(sim.timeoutSec ?? 30)), [sim.timeoutSec]);

  const commitTimeout = () => {
    const v = clampTimeout(timeout);
    setTimeoutText(String(v));
    if (v !== sim.timeoutSec) onSimulate({ timeoutSec: v });
  };

  const iverilogLabel = iverilog ? `Icarus Verilog ${iverilog.version ?? ''}`.trim() : 'Icarus Verilog';

  return (
    <div className="pg-side-inner">
      <Section icon={<Languages size={14} strokeWidth={1.75} />} title="语言与库">
        <label className="pg-field">
          <span>语言标准</span>
          <select className="input" value={sim.standard ?? '2012'} onChange={(e) => onSimulate({ standard: e.target.value as Standard })}>
            {STANDARDS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section icon={<Cpu size={14} strokeWidth={1.75} />} title="工具与仿真器">
        <label className="pg-field">
          <span>仿真器</span>
          <select className="input" value="icarus" onChange={() => undefined}>
            <option value="icarus">{iverilogLabel}</option>
          </select>
        </label>
        {toolsError ? (
          <div className="pg-side-note warn">
            <AlertCircle size={13} strokeWidth={1.75} />
            无法获取工具信息
          </div>
        ) : iverilog && !iverilog.available ? (
          <div className="pg-side-note danger">
            <AlertCircle size={13} strokeWidth={1.75} />
            服务器未安装 Icarus Verilog，无法仿真
          </div>
        ) : null}
        <label className="pg-field">
          <span>编译选项</span>
          <input
            className="input pg-mono"
            value={sim.compileFlags ?? ''}
            placeholder="-DDEBUG -Wall"
            spellCheck={false}
            onChange={(e) => onSimulate({ compileFlags: e.target.value })}
          />
        </label>
        <label className="pg-field">
          <span>运行选项</span>
          <input
            className="input pg-mono"
            value={sim.runFlags ?? ''}
            placeholder="+SEED=1"
            spellCheck={false}
            onChange={(e) => onSimulate({ runFlags: e.target.value })}
          />
        </label>
        <label className="pg-field">
          <span>顶层模块</span>
          <input
            className="input pg-mono"
            value={sim.top ?? ''}
            placeholder="自动检测"
            spellCheck={false}
            onChange={(e) => onSimulate({ top: e.target.value })}
          />
        </label>
        <label className="pg-field">
          <span>超时（秒）</span>
          <input
            className="input"
            type="number"
            min={1}
            max={MAX_TIMEOUT}
            step={1}
            value={timeout}
            onChange={(e) => setTimeoutText(e.target.value)}
            onBlur={commitTimeout}
            onKeyDown={(e) => e.key === 'Enter' && commitTimeout()}
          />
        </label>
        <label className="form-check pg-check">
          <input type="checkbox" checked={sim.autoDump !== false} onChange={(e) => onSimulate({ autoDump: e.target.checked })} />
          <span>自动记录波形（无 $dumpfile 时）</span>
        </label>
      </Section>

      <Section icon={<Settings2 size={14} strokeWidth={1.75} />} title="运行后">
        <label className="form-check pg-check">
          <input type="checkbox" checked={settings.openWaveform} onChange={(e) => onSettings({ openWaveform: e.target.checked })} />
          <span>运行后打开波形 (EPWave)</span>
        </label>
        <label className="form-check pg-check">
          <input type="checkbox" checked={settings.showSchematic} onChange={(e) => onSettings({ showSchematic: e.target.checked })} />
          <span>运行后生成 RTL 原理图</span>
        </label>
        <button className="btn pg-side-btn" onClick={onElaborate} disabled={elaborating} title={yosys?.version ? `Yosys ${yosys.version}` : undefined}>
          <Network size={15} strokeWidth={1.75} />
          {elaborating ? '正在生成原理图…' : '生成原理图 (Yosys)'}
        </button>
      </Section>

      <Section icon={<FileText size={14} strokeWidth={1.75} />} title="说明">
        <textarea
          className="input pg-desc"
          rows={5}
          maxLength={DESCRIPTION_MAX}
          value={description}
          placeholder="简要描述这个 Playground…"
          onChange={(e) => onDescription(e.target.value)}
        />
        <div className="pg-desc-count tabular">
          {description.length} / {DESCRIPTION_MAX}
        </div>
      </Section>
    </div>
  );
}
