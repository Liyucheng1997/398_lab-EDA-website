import { useEffect, useMemo, useState } from 'react';
import { Check, CircuitBoard, Cpu, FilePlus2, LayoutTemplate } from 'lucide-react';
import type { DeviceFamily, DeviceId, ExampleSummary, Project } from '@webeda/shared';
import { BOARDS, DEVICES, getBoard, getDevice } from '@webeda/shared';
import { api } from '../../lib/api';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';
import { buildEmptyProject, buildTemplateProject } from './scaffold';

const FAMILY_LABEL: Record<DeviceFamily, string> = {
  ice40: 'Lattice iCE40',
  ecp5: 'Lattice ECP5',
  xc7: 'Xilinx 7 系列',
  gowin: 'Gowin',
};

type Source = { type: 'empty' } | { type: 'template'; id: string };
type Target = { type: 'board'; id: string } | { type: 'device'; id: DeviceId };

export interface NewProjectWizardProps {
  open: boolean;
  /** 预选模板 id（来自 ?template=） */
  templateId?: string | null;
  onClose: () => void;
  onCreated: (p: Project) => void;
}

const STEPS = ['工程信息', '起点', '器件'];

/** 新建工程向导：名称 → 模板 / 空工程 → 板卡或器件 */
export function NewProjectWizard({ open, templateId, onClose, onCreated }: NewProjectWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [desc, setDesc] = useState('');
  const [source, setSource] = useState<Source>({ type: 'empty' });
  const [target, setTarget] = useState<Target>({ type: 'board', id: BOARDS[0]?.id ?? '' });
  const [targetMode, setTargetMode] = useState<'board' | 'device'>(BOARDS.length ? 'board' : 'device');
  const [templates, setTemplates] = useState<ExampleSummary[] | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCreating(false);
    setDesc('');
    setNameTouched(false);
    setSource(templateId ? { type: 'template', id: templateId } : { type: 'empty' });
    setName('');
    setTarget(BOARDS.length ? { type: 'board', id: BOARDS[0].id } : { type: 'device', id: DEVICES[0].id });
    setTargetMode(BOARDS.length ? 'board' : 'device');
    let alive = true;
    setTplError(null);
    api.examples().then(
      (list) => {
        if (!alive) return;
        const tpls = list.filter((e) => e.scope === 'studio' || e.scope === 'both');
        setTemplates(tpls);
        if (templateId) {
          const t = list.find((e) => e.id === templateId);
          if (t) setName((n) => n || t.title);
          else {
            toast('模板不存在，已改为空工程', 'error');
            setSource({ type: 'empty' });
          }
        }
      },
      (e: Error) => {
        if (!alive) return;
        setTemplates([]);
        setTplError(e.message);
      },
    );
    return () => {
      alive = false;
    };
  }, [open, templateId]);

  const tpl = source.type === 'template' ? templates?.find((t) => t.id === source.id) : undefined;
  const lastStep = source.type === 'empty' ? 2 : 1;
  const nameError = !name.trim() ? '请输入工程名称' : name.trim().length > 200 ? '名称过长' : null;

  const families = useMemo(() => [...new Set(DEVICES.map((d) => d.family))], []);

  const next = () => {
    if (step === 0) {
      setNameTouched(true);
      if (nameError) return;
    }
    if (step < lastStep) setStep(step + 1);
    else void create();
  };

  const create = async () => {
    if (nameError) {
      setStep(0);
      setNameTouched(true);
      return;
    }
    setCreating(true);
    try {
      let input;
      if (source.type === 'template') {
        const ex = await api.example(source.id);
        input = buildTemplateProject({ name: name.trim(), description: desc.trim() || undefined, example: ex });
      } else {
        const board = target.type === 'board' ? getBoard(target.id) : undefined;
        const device = board ? getDevice(board.device) : getDevice(target.type === 'device' ? target.id : undefined);
        if (!device) throw new Error('请选择器件');
        input = buildEmptyProject({ name: name.trim(), description: desc.trim() || undefined, device, board });
      }
      const p = await api.createProject(input);
      toast('工程已创建', 'success');
      onCreated(p);
    } catch (e) {
      toast(`创建失败：${(e as Error).message}`, 'error', 4000);
      setCreating(false);
    }
  };

  const tplDevice = (t: ExampleSummary) => {
    const b = getBoard(t.board);
    return b ? getDevice(b.device) : undefined;
  };

  return (
    <Modal
      open={open}
      title="新建工程"
      onClose={() => !creating && onClose()}
      width={680}
      footer={
        <>
          <div className="st-steps" aria-label="步骤">
            {STEPS.slice(0, lastStep + 1).map((s, i) => (
              <span key={s} className={`st-step${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}>
                <i>{i < step ? <Check size={11} strokeWidth={2.5} /> : i + 1}</i>
                <span className="st-step-label">{s}</span>
              </span>
            ))}
          </div>
          <span className="st-flex1" />
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)} disabled={creating}>
              上一步
            </button>
          )}
          <button className="btn btn-primary" onClick={next} disabled={creating || (step === 1 && source.type === 'template' && !tpl)}>
            {creating ? '创建中…' : step < lastStep ? '下一步' : '创建工程'}
          </button>
        </>
      }
    >
      <div className="st-wizard">
        {step === 0 && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            <label className="form-row">
              <span className="form-label">工程名称</span>
              <input
                className="input"
                autoFocus
                value={name}
                placeholder="例如：流水灯"
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
              />
            </label>
            {nameTouched && nameError && <div className="st-form-error st-indent">{nameError}</div>}
            <label className="form-row st-align-top">
              <span className="form-label">描述</span>
              <textarea className="input" rows={3} value={desc} placeholder="可选" onChange={(e) => setDesc(e.target.value)} />
            </label>
            {tpl && (
              <div className="st-form-hint st-indent">
                将从模板「{tpl.title}」创建
              </div>
            )}
          </form>
        )}

        {step === 1 && (
          <div className="st-choices">
            <button className={`st-choice${source.type === 'empty' ? ' active' : ''}`} onClick={() => setSource({ type: 'empty' })}>
              <span className="st-choice-ico">
                <FilePlus2 size={20} strokeWidth={1.75} />
              </span>
              <span className="st-choice-text">
                <b>空工程</b>
                <small>选择板卡或器件，生成顶层骨架、约束文件与测试平台</small>
              </span>
              {source.type === 'empty' && <Check size={16} strokeWidth={2} className="st-choice-check" />}
            </button>
            <div className="st-choices-title">
              <LayoutTemplate size={14} strokeWidth={1.75} /> 工程模板
            </div>
            {templates === null ? (
              <div className="st-center-row">
                <div className="spinner" />
              </div>
            ) : tplError ? (
              <div className="st-form-error">无法加载模板：{tplError}</div>
            ) : templates.length === 0 ? (
              <div className="muted st-pad">暂无工程模板</div>
            ) : (
              <div className="st-tpl-grid">
                {templates.map((t) => {
                  const d = tplDevice(t);
                  const b = getBoard(t.board);
                  const activeTpl = source.type === 'template' && source.id === t.id;
                  return (
                    <button
                      key={t.id}
                      className={`st-choice st-tpl${activeTpl ? ' active' : ''}`}
                      onClick={() => {
                        setSource({ type: 'template', id: t.id });
                        if (!name.trim() || templates.some((x) => x.title === name)) setName(t.title);
                      }}
                    >
                      <span className="st-choice-text">
                        <b>{t.title}</b>
                        <small>{t.description}</small>
                        <span className="st-tags">
                          {b && <span className="st-tag">{b.name}</span>}
                          {d && <span className="st-tag">{d.partNumber}</span>}
                          {!b && t.board && <span className="st-tag">{t.board}</span>}
                        </span>
                      </span>
                      {activeTpl && <Check size={16} strokeWidth={2} className="st-choice-check" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 2 && source.type === 'empty' && (
          <div className="st-target">
            <div className="seg">
              <button
                className={targetMode === 'board' ? 'active' : ''}
                disabled={!BOARDS.length}
                onClick={() => {
                  setTargetMode('board');
                  if (target.type !== 'board' && BOARDS.length) setTarget({ type: 'board', id: BOARDS[0].id });
                }}
              >
                <CircuitBoard size={13} strokeWidth={1.75} /> 板卡
              </button>
              <button
                className={targetMode === 'device' ? 'active' : ''}
                onClick={() => {
                  setTargetMode('device');
                  if (target.type !== 'device') {
                    const b = getBoard(target.id);
                    setTarget({ type: 'device', id: b?.device ?? DEVICES[0].id });
                  }
                }}
              >
                <Cpu size={13} strokeWidth={1.75} /> 器件
              </button>
            </div>
            {targetMode === 'board' ? (
              <div className="st-tpl-grid">
                {BOARDS.map((b) => {
                  const d = getDevice(b.device);
                  const act = target.type === 'board' && target.id === b.id;
                  return (
                    <button key={b.id} className={`st-choice st-tpl${act ? ' active' : ''}`} onClick={() => setTarget({ type: 'board', id: b.id })} onDoubleClick={() => void create()}>
                      <span className="st-choice-text">
                        <b>{b.name}</b>
                        <small>
                          {b.vendor} · {b.clock.freqMHz} MHz 时钟 · {b.pins.length} 个引脚
                        </small>
                        <span className="st-tags">
                          {d && <span className="st-tag">{d.partNumber}</span>}
                          {d && <span className={`st-tag ${d.pnr ? 'st-tag-ok' : 'st-tag-warn'}`}>{d.pnr ? '完整实现' : '仅综合'}</span>}
                        </span>
                      </span>
                      {act && <Check size={16} strokeWidth={2} className="st-choice-check" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="st-device-list">
                {families.map((fam) => (
                  <div key={fam} className="st-device-fam">
                    <div className="st-choices-title">{FAMILY_LABEL[fam]}</div>
                    {DEVICES.filter((d) => d.family === fam).map((d) => {
                      const act = target.type === 'device' && target.id === d.id;
                      return (
                        <button key={d.id} className={`st-device-row${act ? ' active' : ''}`} onClick={() => setTarget({ type: 'device', id: d.id })} onDoubleClick={() => void create()}>
                          <span className="st-device-row-name">
                            <b>{d.name}</b>
                            <small className="st-mono">{d.partNumber}</small>
                          </span>
                          <span className={`st-tag ${d.pnr ? 'st-tag-ok' : 'st-tag-warn'}`}>{d.pnr ? '完整实现' : '仅综合'}</span>
                          {act && <Check size={15} strokeWidth={2} className="st-choice-check" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
                <div className="st-form-hint">“仅综合”器件（Xilinx 7 系列、Gowin）可以综合并估算资源，但开源工具链暂不支持其布局布线与比特流。</div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
