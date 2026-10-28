import { useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, ArrowLeft, Activity, Search } from 'lucide-react';
import type { BoardMap } from '../sim/peripherals';
import { formatPortValue, parsePortValue, type Radix } from '../display';

const ICON = { size: 15, strokeWidth: 1.75 };

export interface ProbePanelProps {
  map: BoardMap;
  values: Uint8Array | null;
  /** 输入电平（主线程即时状态） */
  inputs: Record<number, number>;
  onSetInput: (index: number, level: number) => void;
}

/** 逻辑探针：列出所有端口的当前值，输入端口可直接改值 */
export function ProbePanel({ map, values, inputs, onSetInput }: ProbePanelProps) {
  const [radix, setRadix] = useState<Radix>('hex');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [draftErr, setDraftErr] = useState(false);

  const clockSet = useMemo(() => new Set(map.clocks.map((c) => c.port)), [map]);
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return map.ports.map((p, i) => ({ p, i })).filter(({ p }) => !f || p.name.toLowerCase().includes(f));
  }, [map, filter]);

  const current = (pi: number): number[] => {
    const p = map.ports[pi];
    const off = map.portOffset[pi];
    const out: number[] = [];
    for (let b = 0; b < p.bits.length; b++) {
      const idx = off + b;
      out.push(p.direction === 'input' && inputs[idx] !== undefined ? inputs[idx] : values ? values[idx] : 0);
    }
    return out;
  };

  const commit = (pi: number) => {
    const p = map.ports[pi];
    const bits = parsePortValue(draft, p.bits.length, radix);
    if (!bits) {
      setDraftErr(true);
      return;
    }
    const off = map.portOffset[pi];
    bits.forEach((lv, b) => onSetInput(off + b, lv));
    setEditing(null);
  };

  return (
    <div className="panel vb-probe">
      <div className="panel-header">
        <Activity {...ICON} className="ico" aria-hidden />
        <span className="vb-panel-title">逻辑探针</span>
        <span className="badge">{map.ports.length}</span>
        <span className="spacer" />
        <div className="seg vb-seg-sm" aria-label="进制">
          {(['hex', 'bin', 'dec'] as const).map((r) => (
            <button key={r} type="button" className={radix === r ? 'active' : ''} onClick={() => setRadix(r)}>
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {map.ports.length > 10 && (
        <div className="vb-probe-filter">
          <Search {...ICON} size={14} className="ico" aria-hidden />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="筛选端口" aria-label="筛选端口" />
        </div>
      )}
      <div className="panel-body">
        {map.ports.length === 0 ? (
          <div className="empty vb-empty-sm">设计没有顶层端口</div>
        ) : (
          <table className="table vb-probe-table">
            <thead>
              <tr>
                <th aria-label="方向" />
                <th>端口</th>
                <th className="num">位宽</th>
                <th>值</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, i }) => {
                const isIn = p.direction === 'input';
                const isClk = clockSet.has(i);
                const editable = isIn && !isClk;
                const bits = current(i);
                const text = formatPortValue(bits, 0, bits.length, radix);
                const Dir = p.direction === 'input' ? ArrowRight : p.direction === 'output' ? ArrowLeft : ArrowLeftRight;
                return (
                  <tr key={i}>
                    <td className="vb-probe-dir" title={p.direction === 'input' ? '输入' : p.direction === 'output' ? '输出' : '双向'}>
                      <Dir size={13} strokeWidth={1.75} className={isIn ? 'vb-dir-in' : 'vb-dir-out'} />
                    </td>
                    <td>
                      <div className="vb-probe-name">{p.name}</div>
                      {map.portRole[i] && <div className="vb-probe-role">{map.portRole[i]}</div>}
                    </td>
                    <td className="num">{p.bits.length}</td>
                    <td className="vb-probe-val">
                      {editing === i ? (
                        <input
                          autoFocus
                          className={`input vb-probe-input${draftErr ? ' vb-input-err' : ''}`}
                          value={draft}
                          onChange={(e) => {
                            setDraft(e.target.value);
                            setDraftErr(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commit(i);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          onBlur={() => setEditing(null)}
                          aria-label={`设置 ${p.name}`}
                          spellCheck={false}
                        />
                      ) : editable ? (
                        <button
                          type="button"
                          className="vb-probe-edit"
                          title="点击修改输入值（支持 0x / 0b / 'd 前缀）"
                          onClick={() => {
                            if (p.bits.length === 1) {
                              onSetInput(map.portOffset[i], bits[0] ? 0 : 1);
                              return;
                            }
                            setDraft(text.replace(/_/g, ''));
                            setDraftErr(false);
                            setEditing(i);
                          }}
                        >
                          {text}
                        </button>
                      ) : (
                        <span className={isClk ? 'vb-probe-clk' : undefined}>{isClk ? `${text} · 时钟` : text}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
