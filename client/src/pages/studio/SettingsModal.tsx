import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { DeviceFamily, ProjectSettings, SimulateOptions, SourceFile } from '@webeda/shared';
import { BOARDS, DEVICES, getBoard, getDevice } from '@webeda/shared';
import { Modal } from '../../ui/Modal';
import { constraintFiles, moduleInfo } from './model';

const FAMILY_LABEL: Record<DeviceFamily, string> = {
  ice40: 'Lattice iCE40',
  ecp5: 'Lattice ECP5',
  xc7: 'Xilinx 7 系列',
  gowin: 'Gowin',
};

const STANDARDS: NonNullable<SimulateOptions['standard']>[] = ['1995', '2001', '2005', '2012'];

interface ParamRow {
  key: string;
  value: string;
}

export interface SettingsDraft {
  name: string;
  description: string;
  settings: ProjectSettings;
}

/** 工程设置：器件、板卡、顶层、约束、频率、综合与仿真选项、虚拟板参数覆盖 */
export function SettingsModal({
  open,
  name,
  description,
  settings,
  files,
  onClose,
  onApply,
}: {
  open: boolean;
  name: string;
  description?: string;
  settings: ProjectSettings;
  files: SourceFile[];
  onClose: () => void;
  onApply: (d: SettingsDraft) => void;
}) {
  const [draft, setDraft] = useState<ProjectSettings>(settings);
  const [pname, setPname] = useState(name);
  const [desc, setDesc] = useState(description ?? '');
  const [params, setParams] = useState<ParamRow[]>([]);
  const [freqText, setFreqText] = useState(String(settings.freqMHz));
  const [timeoutText, setTimeoutText] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setPname(name);
    setDesc(description ?? '');
    setFreqText(String(settings.freqMHz));
    setTimeoutText(settings.simulate?.timeoutSec ? String(settings.simulate.timeoutSec) : '');
    setParams(Object.entries(settings.gatesimParams ?? {}).map(([key, v]) => ({ key, value: String(v) })));
    // 打开时用当前设置初始化草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const device = getDevice(draft.device);
  const boards = useMemo(() => BOARDS.filter((b) => b.device === draft.device), [draft.device]);
  const design = useMemo(() => moduleInfo(files, ['design', 'include']), [files]);
  const tb = useMemo(() => moduleInfo(files, ['testbench']), [files]);
  const constraints = useMemo(() => constraintFiles(files, draft.device), [files, draft.device]);
  const families = useMemo(() => [...new Set(DEVICES.map((d) => d.family))], []);

  const set = (patch: Partial<ProjectSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const setSim = (patch: Partial<SimulateOptions>) => setDraft((d) => ({ ...d, simulate: { ...d.simulate, ...patch } }));

  const freq = Number(freqText);
  const freqError = !Number.isFinite(freq) || freq <= 0 || freq > 1000 ? '频率需在 0–1000 MHz 之间' : null;
  const timeout = timeoutText.trim() === '' ? undefined : Number(timeoutText);
  const timeoutError = timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) ? '超时需为 1–120 的整数秒' : null;
  const paramErrors = params.map((r) => {
    if (!r.key.trim() && !r.value.trim()) return null;
    if (!/^[A-Za-z_]\w*$/.test(r.key.trim())) return '参数名不合法';
    if (!/^-?\d+$/.test(r.value.trim())) return '值必须是整数';
    return null;
  });
  const keys = params.map((r) => r.key.trim()).filter(Boolean);
  const dupKey = keys.find((k, i) => keys.indexOf(k) !== i);
  const nameError = !pname.trim() ? '工程名不能为空' : null;
  const hasError = !!(freqError || timeoutError || paramErrors.some(Boolean) || dupKey || nameError);

  const apply = () => {
    if (hasError) return;
    const gp: Record<string, number> = {};
    for (const r of params) if (r.key.trim()) gp[r.key.trim()] = Number(r.value.trim());
    const simulate: SimulateOptions = { ...draft.simulate, timeoutSec: timeout };
    if (timeout === undefined) delete simulate.timeoutSec;
    onApply({
      name: pname.trim().slice(0, 200),
      description: desc.trim().slice(0, 4000),
      settings: {
        ...draft,
        freqMHz: freq,
        simulate,
        gatesimParams: Object.keys(gp).length ? gp : undefined,
        top: draft.top || undefined,
        simTop: draft.simTop || undefined,
        constraintFile: draft.constraintFile || undefined,
        board: draft.board || undefined,
      },
    });
  };

  const opt = (list: string[], cur?: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);

  return (
    <Modal
      open={open}
      title="工程设置"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={apply} disabled={hasError}>
            应用
          </button>
        </>
      }
    >
      <form
        className="form st-settings"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="st-settings-sec">常规</div>
        <label className="form-row">
          <span className="form-label">工程名称</span>
          <input className="input" value={pname} onChange={(e) => setPname(e.target.value)} />
        </label>
        {nameError && <div className="st-form-error st-indent">{nameError}</div>}
        <label className="form-row st-align-top">
          <span className="form-label">描述</span>
          <textarea className="input" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>

        <div className="st-settings-sec">器件与板卡</div>
        <label className="form-row">
          <span className="form-label">器件</span>
          <select
            className="input"
            value={draft.device}
            onChange={(e) => {
              const id = e.target.value as ProjectSettings['device'];
              const b = getBoard(draft.board);
              const ext = getDevice(id)?.constraintExt;
              const cf = draft.constraintFile;
              const matching = ext ? constraintFiles(files, id).find((n) => n.toLowerCase().endsWith(ext)) : undefined;
              set({
                device: id,
                board: b && b.device === id ? b.id : undefined,
                constraintFile: cf && ext && !cf.toLowerCase().endsWith(ext) ? matching ?? cf : cf,
              });
            }}
          >
            {families.map((fam) => (
              <optgroup key={fam} label={FAMILY_LABEL[fam]}>
                {DEVICES.filter((d) => d.family === fam).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.partNumber}
                    {d.pnr ? '' : '（仅综合）'}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {device && !device.pnr && (
          <div className="st-form-hint st-indent">该器件暂不支持开源布局布线：可以综合与估算资源，但不能运行实现或生成比特流。</div>
        )}
        <label className="form-row">
          <span className="form-label">板卡</span>
          <select
            className="input"
            value={draft.board ?? ''}
            onChange={(e) => {
              const b = getBoard(e.target.value);
              set({ board: b?.id, ...(b ? { freqMHz: b.clock.freqMHz } : {}) });
              if (b) setFreqText(String(b.clock.freqMHz));
            }}
          >
            <option value="">无（裸器件）</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.vendor}
              </option>
            ))}
          </select>
        </label>
        {boards.length === 0 && <div className="st-form-hint st-indent">没有使用该器件的内置板卡。</div>}

        <div className="st-settings-sec">综合与实现</div>
        <label className="form-row">
          <span className="form-label">顶层模块</span>
          <select className="input" value={draft.top ?? ''} onChange={(e) => set({ top: e.target.value || undefined })}>
            <option value="">自动（{design.tops[0] ?? '未找到模块'}）</option>
            {opt(design.all, draft.top).map((m) => (
              <option key={m} value={m}>
                {m}
                {design.tops.includes(m) ? '' : '（被实例化）'}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span className="form-label">约束文件</span>
          <select className="input" value={draft.constraintFile ?? ''} onChange={(e) => set({ constraintFile: e.target.value || undefined })}>
            <option value="">无</option>
            {opt(constraints, draft.constraintFile).map((c) => (
              <option key={c} value={c}>
                {c}
                {device && !c.toLowerCase().endsWith(device.constraintExt) ? `（与 ${device.constraintExt} 不匹配）` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span className="form-label">目标频率</span>
          <input className="input st-num-input" type="number" min={0.1} step="any" value={freqText} onChange={(e) => setFreqText(e.target.value)} />
          <span className="muted">MHz</span>
        </label>
        {freqError && <div className="st-form-error st-indent">{freqError}</div>}
        <label className="form-check st-indent">
          <input type="checkbox" checked={draft.synth?.flatten ?? true} onChange={(e) => set({ synth: { ...draft.synth, flatten: e.target.checked } })} />
          综合时展平层次（flatten）
        </label>

        <div className="st-settings-sec">仿真</div>
        <label className="form-row">
          <span className="form-label">仿真顶层</span>
          <select className="input" value={draft.simTop ?? ''} onChange={(e) => set({ simTop: e.target.value || undefined })}>
            <option value="">自动（{tb.tops[0] ?? '由 iverilog 选择'}）</option>
            {opt(tb.all, draft.simTop).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span className="form-label">语言标准</span>
          <select className="input" value={draft.simulate?.standard ?? '2012'} onChange={(e) => setSim({ standard: e.target.value as SimulateOptions['standard'] })}>
            {STANDARDS.map((s) => (
              <option key={s} value={s}>
                {s === '2012' ? 'SystemVerilog 2012' : `Verilog ${s}`}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span className="form-label">超时</span>
          <input
            className="input st-num-input"
            type="number"
            min={1}
            max={120}
            placeholder="30"
            value={timeoutText}
            onChange={(e) => setTimeoutText(e.target.value)}
          />
          <span className="muted">秒</span>
        </label>
        {timeoutError && <div className="st-form-error st-indent">{timeoutError}</div>}

        <div className="st-settings-sec">虚拟开发板参数覆盖</div>
        <div className="st-form-hint">构建虚拟开发板时用这些值覆盖顶层参数（chparam），例如把分频计数器位宽改小，便于在浏览器里实时观察。</div>
        <div className="st-params">
          {params.map((r, i) => (
            <div key={i} className="st-param-row">
              <input
                className="input"
                placeholder="参数名"
                value={r.key}
                spellCheck={false}
                onChange={(e) => setParams((ps) => ps.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              />
              <span className="muted">=</span>
              <input
                className="input st-num-input"
                placeholder="整数"
                value={r.value}
                onChange={(e) => setParams((ps) => ps.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <button type="button" className="icon-btn st-icon-sm" title="删除" onClick={() => setParams((ps) => ps.filter((_, j) => j !== i))}>
                <X size={14} strokeWidth={1.75} />
              </button>
              {paramErrors[i] && <span className="st-form-error">{paramErrors[i]}</span>}
            </div>
          ))}
          {dupKey && <div className="st-form-error">参数名重复：{dupKey}</div>}
          <button type="button" className="btn btn-sm btn-ghost st-self-start" onClick={() => setParams((ps) => [...ps, { key: '', value: '' }])}>
            <Plus size={14} strokeWidth={1.75} />
            添加参数
          </button>
        </div>
      </form>
    </Modal>
  );
}
