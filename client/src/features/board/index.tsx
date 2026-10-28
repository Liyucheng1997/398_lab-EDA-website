// 虚拟开发板：在浏览器（Web Worker）里对门级网表做周期仿真，用 LED / 开关 / 按键 / 数码管 / 串口交互。
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, Cpu, Hammer, Info, Keyboard, OctagonAlert } from 'lucide-react';
import type { BoardInfo, GateNetlist } from '@webeda/shared';
import { useBoardSim } from './useBoardSim';
import { Toolbar } from './components/Toolbar';
import { Indicator, Led, PushButton, RgbLed, SlideSwitch, Toggle } from './components/Peripherals';
import { SevenSegDigit } from './components/SevenSeg';
import { UartTerminal } from './components/UartTerminal';
import { ProbePanel } from './components/ProbePanel';
import { activeDuty, formatCount, ledLevel, muxSegLevels, staticSegLevels } from './display';
import { bitPeriod } from './sim/uart';
import type { InputCtl } from './sim/peripherals';
import './board.css';

export interface VirtualBoardProps {
  /** gatesim 任务产出的门级网表；null = 还没构建 */
  netlist: GateNetlist | null;
  /** 板卡信息（决定外设数量与时钟频率显示）；缺省时根据端口名自动推断外设 */
  board?: BoardInfo;
  /** 用户点击“构建/重新构建”时回调（页面负责跑 gatesim 任务并传回 netlist） */
  onBuild?: () => void;
  building?: boolean;
  className?: string;
  /** 没有板卡信息时的默认设计时钟频率（MHz），缺省 12 */
  defaultFreqMHz?: number;
  /** 构建失败等需要显示在空状态里的错误信息 */
  buildError?: string | null;
}

const ICON = { size: 16, strokeWidth: 1.75 };
const BAUD_KEY = 'webeda.board.baud';
const MAX_GENERIC = 64;
const MAX_INDICATORS = 128;

function loadBaud(): number {
  try {
    const n = Number(localStorage.getItem(BAUD_KEY));
    if (Number.isFinite(n) && n >= 50 && n <= 100_000_000) return n;
  } catch {
    /* ignore */
  }
  return 115200;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export function VirtualBoard({ netlist, board, onBuild, building, className, defaultFreqMHz, buildError }: VirtualBoardProps) {
  const boardFreq = board?.clock.freqMHz ?? defaultFreqMHz ?? 12;
  const [freqMHz, setFreqMHz] = useState(boardFreq);
  useEffect(() => setFreqMHz(boardFreq), [boardFreq]);
  const [baud, setBaudState] = useState(loadBaud);
  const setBaud = (b: number) => {
    setBaudState(b);
    try {
      localStorage.setItem(BAUD_KEY, String(b));
    } catch {
      /* ignore */
    }
  };

  const sim = useBoardSim(netlist, board, freqMHz * 1e6, baud);
  const { map, snap, inputs, setInput } = sim;

  // 数码管极性（默认按命名约定，可在界面上切换）
  const [segLowOv, setSegLowOv] = useState<boolean | null>(null);
  const [anLowOv, setAnLowOv] = useState<boolean | null>(null);
  useEffect(() => {
    setSegLowOv(null);
    setAnLowOv(null);
  }, [map]);

  const duty = snap?.duty ?? null;
  const values = snap?.values ?? null;
  const d = useCallback((idx: number) => (duty ? (duty[idx] ?? 0) : 0), [duty]);
  const inputLevel = (c: InputCtl) => inputs[c.ref.index] ?? c.idle;
  const disabled = sim.status !== 'ready';

  /** 板卡引脚说明（悬停提示） */
  const pins = useMemo(() => new Map((board?.pins ?? []).map((pin) => [pin.signal.toLowerCase(), pin])), [board]);
  const pinNote = (name: string) => {
    const pin = pins.get(name.toLowerCase());
    return pin ? `
${pin.label ?? pin.signal} · 引脚 ${pin.pin}` : '';
  };

  /* ───── 键盘 ───── */
  const heldKeys = useRef(new Map<string, InputCtl>());
  const pressables = useMemo(() => (map ? [...map.buttons, ...map.resets] : []), [map]);
  const pressCtl = useCallback((c: InputCtl, down: boolean) => setInput(c.ref.index, down === c.activeLow ? 0 : 1), [setInput]);
  const toggleCtl = useCallback((c: InputCtl) => setInput(c.ref.index, (inputs[c.ref.index] ?? c.idle) ? 0 : 1), [setInput, inputs]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!map || disabled || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const sw = map.switches.find((s) => s.key === k);
    if (sw) {
      e.preventDefault();
      if (!e.repeat) toggleCtl(sw);
      return;
    }
    const b = pressables.find((s) => s.key === k);
    if (b) {
      e.preventDefault();
      if (!e.repeat && !heldKeys.current.has(k)) {
        heldKeys.current.set(k, b);
        pressCtl(b, true);
      }
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.toLowerCase();
    const b = heldKeys.current.get(k);
    if (b) {
      heldKeys.current.delete(k);
      pressCtl(b, false);
    }
  };
  const releaseAll = () => {
    for (const b of heldKeys.current.values()) pressCtl(b, false);
    heldKeys.current.clear();
  };
  useEffect(() => heldKeys.current.clear(), [map]);

  /* ───── 数码管 ───── */
  const mux = map?.segMux ?? null;
  const segLow = segLowOv ?? mux?.segActiveLow ?? false;
  const anLow = anLowOv ?? mux?.anActiveLow ?? false;
  const muxLevels = useMemo(() => (mux && duty ? muxSegLevels(mux, snap?.segJoint ?? null, duty, anLow, segLow) : null), [mux, duty, snap, anLow, segLow]);

  /* ───── 渲染 ───── */
  const root = (children: ReactNode) => (
    <div className={`vb${className ? ` ${className}` : ''}`}>{children}</div>
  );

  if (!netlist) {
    return root(
      <div className="vb-empty card">
        {building ? (
          <>
            <div className="spinner" />
            <div className="vb-empty-title">正在构建门级网表…</div>
            <div className="vb-empty-sub">Yosys 综合到通用门后会自动加载到虚拟开发板</div>
          </>
        ) : (
          <>
            <Cpu size={34} strokeWidth={1.4} className="vb-empty-ico" />
            <div className="vb-empty-title">虚拟开发板</div>
            <div className="vb-empty-sub">
              {buildError ? (
                <span className="vb-err-text">{buildError}</span>
              ) : (
                <>把设计综合为门级网表后，在浏览器里实时运行：LED、拨码开关、按键、数码管和串口都按顶层端口名自动连接。</>
              )}
            </div>
            {onBuild && (
              <button type="button" className="btn btn-primary" onClick={onBuild}>
                <Hammer {...ICON} />
                构建并加载
              </button>
            )}
          </>
        )}
      </div>,
    );
  }

  const hasClock = !!map && map.clocks.length > 0;
  const nInfo = sim.info;
  const padLeds = Math.max(0, (board?.virtual.leds ?? 0) - (map?.leds.length ?? 0));
  const padSw = Math.max(0, (board?.virtual.switches ?? 0) - (map?.switches.length ?? 0));
  const padBtn = Math.max(0, (board?.virtual.buttons ?? 0) - (map ? map.buttons.length + map.resets.length : 0));
  const muxDigits = mux ? Math.max(1, mux.digits.length) : 0;
  const staticDigits = map?.segStatics.length ?? 0;
  const padDigits = Math.max(0, (board?.virtual.sevenSegDigits ?? 0) - muxDigits - staticDigits);
  const hasDisplay = muxDigits + staticDigits > 0;
  const hasLeds = !!map && map.leds.length + map.rgbs.length + padLeds > 0;
  const hasSwitches = !!map && map.switches.length + padSw > 0;
  const hasButtons = !!map && map.buttons.length + map.resets.length + padBtn > 0;
  const nothingMapped = !!map && !hasDisplay && !hasLeds && !hasSwitches && !hasButtons && !map.uartTx && !map.uartRx;
  const hasUart = !!map && (!!map.uartTx || !!map.uartRx);
  const kbdHint = !!map && (map.switches.some((s) => s.key) || pressables.some((b) => b.key));

  return root(
    <>
      <Toolbar
        running={sim.running}
        stepping={snap?.mode === 'stepping'}
        disabled={disabled}
        speed={sim.speed}
        achievedHz={snap?.achievedHz ?? 0}
        cycles={snap?.cycles ?? 0}
        freqMHz={freqMHz}
        onFreqMHz={setFreqMHz}
        onToggle={sim.toggle}
        onStep={sim.step}
        onReset={sim.reset}
        onSpeed={sim.setSpeed}
        onBuild={onBuild}
        building={building}
        hasClock={hasClock}
      />

      {(sim.error || buildError) && (
        <div className="vb-alert vb-alert-danger" role="alert">
          <OctagonAlert {...ICON} className="ico" />
          <span>{sim.error ?? buildError}</span>
        </div>
      )}
      {netlist.combinationalLoop && (
        <div className="vb-alert vb-alert-warn">
          <AlertTriangle {...ICON} className="ico" />
          <span>设计含组合环路：仿真改用迭代求值直到稳定（最多 64 遍），速度会变慢；请检查是否有意为之。</span>
        </div>
      )}
      {snap?.oscillating && (
        <div className="vb-alert vb-alert-danger">
          <OctagonAlert {...ICON} className="ico" />
          <span>检测到组合振荡或时钟无法收敛：电路在一次求值内反复翻转，显示结果可能不可靠。点击「上电复位」清除此提示。</span>
        </div>
      )}
      {map && !hasClock && sim.status === 'ready' && (
        <div className="vb-alert vb-alert-info">
          <Info {...ICON} className="ico" />
          <span>未识别到时钟输入（clk / clock / clk12 / sys_clk…）：电路只在输入变化时更新，触发器若由按键驱动仍可工作。</span>
        </div>
      )}
      {(sim.engine === 'main' || (nInfo && !nInfo.compiled && nInfo.gates > 0)) && (
        <div className="vb-alert vb-alert-info">
          <Info {...ICON} className="ico" />
          <span>
            {sim.engine === 'main' ? '当前环境无法启动 Web Worker，仿真在页面主线程运行。' : ''}
            {nInfo && !nInfo.compiled && nInfo.gates > 0 ? '网表未能编译为 JavaScript（可能受内容安全策略限制），已改用解释执行，速度较慢。' : ''}
          </span>
        </div>
      )}

      <div className={`vb-main${hasUart ? ' has-uart' : ''}`}>
        <section
          className="vb-board card"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) releaseAll();
          }}
          aria-label="虚拟开发板（获得焦点后可用键盘操作开关与按键）"
        >
          <header className="vb-board-head">
            <div className="vb-chip-ico" aria-hidden>
              <Cpu size={18} strokeWidth={1.75} />
            </div>
            <div className="vb-board-title">
              <b>{netlist.top || '顶层模块'}</b>
              <small>
                {board ? `${board.vendor} ${board.name}` : '通用虚拟开发板'}
                {map?.clockName ? ` · ${map.clockName} @ ${freqMHz} MHz` : ''}
              </small>
            </div>
            <span className="spacer" />
            <div className="vb-board-stats tabular" title="组合门 / 触发器 / 锁存器">
              <span>
                门 <b>{formatCount(netlist.stats.gates)}</b>
              </span>
              <span>
                FF <b>{formatCount(netlist.stats.flipflops)}</b>
              </span>
              {netlist.stats.latches > 0 && (
                <span>
                  锁存器 <b>{formatCount(netlist.stats.latches)}</b>
                </span>
              )}
            </div>
            <span className={`vb-power${sim.running ? ' on' : ''}`} title={sim.running ? '运行中' : sim.status === 'loading' ? '加载中' : '已暂停'}>
              <i />
              {sim.status === 'loading' ? '加载中' : sim.running ? '运行' : '暂停'}
            </span>
          </header>

          <div className="vb-pcb">
            {sim.status === 'loading' && !snap && (
              <div className="vb-loading">
                <div className="spinner" />
                编译网表…
              </div>
            )}

            {map && hasDisplay && (
              <div className="vb-section">
                <div className="vb-section-head">
                  <span>数码管</span>
                  {mux && (
                    <span className="vb-pol">
                      <button type="button" className={`chip${segLow ? ' active' : ''}`} onClick={() => setSegLowOv(!segLow)} title={`段选 ${mux.segName}：点击切换有效电平`}>
                        段{segLow ? '低' : '高'}有效
                      </button>
                      {mux.digits.length > 0 && (
                        <button type="button" className={`chip${anLow ? ' active' : ''}`} onClick={() => setAnLowOv(!anLow)} title={`位选 ${mux.anName ?? ''}：点击切换有效电平`}>
                          位{anLow ? '低' : '高'}有效
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <div className="vb-display">
                  {Array.from({ length: padDigits }, (_, i) => (
                    <SevenSegDigit key={`pad${i}`} levels={new Float32Array(8)} hasDp={false} />
                  ))}
                  {[...(map.segStatics ?? [])]
                    .map((s, i) => ({ s, i }))
                    .reverse()
                    .map(({ s, i }) => (
                      <SevenSegDigit key={`st${i}`} levels={duty ? staticSegLevels(s.segs, duty, s.activeLow) : new Float32Array(8)} hasDp={!!s.segs[7]} label={s.label} />
                    ))}
                  {mux &&
                    Array.from({ length: muxDigits }, (_, k) => muxDigits - 1 - k).map((dIdx) => (
                      <SevenSegDigit
                        key={`mx${dIdx}`}
                        levels={muxLevels ? muxLevels.subarray(dIdx * 8, dIdx * 8 + 8) : new Float32Array(8)}
                        hasDp={!!mux.segs[7]}
                        label={mux.digits.length ? mux.digits[dIdx].name : mux.segName}
                      />
                    ))}
                </div>
              </div>
            )}

            {map && hasLeds && (
              <div className="vb-section">
                <div className="vb-section-head">
                  <span>LED</span>
                </div>
                <div className="vb-row vb-leds">
                  {map.rgbs.map((r, i) => (
                    <RgbLed
                      key={`rgb${i}`}
                      label={r.label}
                      title={[r.r, r.g, r.b].map((x) => x?.name).filter(Boolean).join(' / ')}
                      r={r.r ? ledLevel(activeDuty(d(r.r.index), r.activeLow)) : 0}
                      g={r.g ? ledLevel(activeDuty(d(r.g.index), r.activeLow)) : 0}
                      b={r.b ? ledLevel(activeDuty(d(r.b.index), r.activeLow)) : 0}
                    />
                  ))}
                  {Array.from({ length: padLeds }, (_, i) => (
                    <Led key={`pad${i}`} level={0} color="green" label="—" title="板载 LED（设计未使用）" dim />
                  ))}
                  {[...map.leds].reverse().map((l) => (
                    <Led
                      key={l.ref.index}
                      level={ledLevel(activeDuty(d(l.ref.index), l.activeLow))}
                      color={l.color}
                      label={l.label}
                      title={`${l.ref.name}${l.activeLow ? '（低电平点亮）' : ''}${pinNote(l.ref.name)}`}
                    />
                  ))}
                </div>
              </div>
            )}

            {map && hasSwitches && (
              <div className="vb-section">
                <div className="vb-section-head">
                  <span>拨码开关</span>
                </div>
                <div className="vb-row vb-switches">
                  {Array.from({ length: padSw }, (_, i) => (
                    <SlideSwitch key={`pad${i}`} on={false} label="—" title="板载开关（设计未使用）" disabled />
                  ))}
                  {[...map.switches].reverse().map((s) => {
                    const lv = inputLevel(s);
                    const on = s.activeLow ? lv === 0 : lv === 1;
                    return (
                      <SlideSwitch
                        key={s.ref.index}
                        on={on}
                        label={s.label}
                        hint={s.key}
                        title={`${s.ref.name} = ${lv}${s.key ? `（快捷键 ${s.key}）` : ''}${pinNote(s.ref.name)}`}
                        onToggle={() => toggleCtl(s)}
                        disabled={disabled}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {map && hasButtons && (
              <div className="vb-section">
                <div className="vb-section-head">
                  <span>按键</span>
                </div>
                <div className="vb-row vb-buttons">
                  {map.resets.map((r) => (
                    <PushButton
                      key={r.ref.index}
                      variant="reset"
                      pressed={inputLevel(r) !== r.idle}
                      label={r.label}
                      hint={r.key}
                      title={`${r.ref.name}${r.activeLow ? '（低有效）' : ''}：按住复位${r.key ? `（快捷键 ${r.key}）` : ''}${pinNote(r.ref.name)}`}
                      onPress={(down) => pressCtl(r, down)}
                      disabled={disabled}
                    />
                  ))}
                  {map.buttons.map((b) => (
                    <PushButton
                      key={b.ref.index}
                      pressed={inputLevel(b) !== b.idle}
                      label={b.label}
                      hint={b.key}
                      title={`${b.ref.name}${b.activeLow ? '（低有效，按下为 0）' : ''}${b.key ? `（快捷键 ${b.key}）` : ''}${pinNote(b.ref.name)}`}
                      onPress={(down) => pressCtl(b, down)}
                      disabled={disabled}
                    />
                  ))}
                  {Array.from({ length: padBtn }, (_, i) => (
                    <PushButton key={`pad${i}`} pressed={false} label="—" title="板载按键（设计未使用）" disabled />
                  ))}
                </div>
              </div>
            )}

            {map && map.genericInputs.length > 0 && (
              <div className="vb-section">
                <div className="vb-section-head">
                  <span>其他输入</span>
                  {map.genericInputs.length > MAX_GENERIC && <small className="muted">仅显示前 {MAX_GENERIC} 位，其余可在逻辑探针中设置</small>}
                </div>
                <div className="vb-row vb-generic">
                  {map.genericInputs.slice(0, MAX_GENERIC).map((g) => (
                    <Toggle key={g.ref.index} on={inputLevel(g) === 1} label={g.label} onToggle={() => toggleCtl(g)} />
                  ))}
                </div>
              </div>
            )}

            {map && map.genericOutputs.length > 0 && (
              <div className="vb-section">
                <div className="vb-section-head">
                  <span>其他输出</span>
                  {map.genericOutputs.length > MAX_INDICATORS && <small className="muted">仅显示前 {MAX_INDICATORS} 位，完整数值见逻辑探针</small>}
                </div>
                <div className="vb-row vb-generic">
                  {map.genericOutputs.slice(0, MAX_INDICATORS).map((o) => (
                    <Indicator key={o.ref.index} level={d(o.ref.index)} label={o.label} />
                  ))}
                </div>
              </div>
            )}

            {nothingMapped && map.genericInputs.length === 0 && map.genericOutputs.length === 0 && (
              <div className="vb-hint">设计没有可连接到开发板的端口。</div>
            )}
            {nothingMapped && (map.genericInputs.length > 0 || map.genericOutputs.length > 0) && (
              <div className="vb-hint">
                未识别到板载外设。按命名约定连接：led / sw / btn / seg + an / rgb / tx / rx / clk / rst_n（_n 结尾为低有效）。
              </div>
            )}
          </div>

          {kbdHint && (
            <footer className="vb-board-foot">
              <Keyboard size={14} strokeWidth={1.75} className="ico" aria-hidden />
              点击开发板后可用键盘：数字键切换开关，字母键按住按键
              {map?.resets.some((r) => r.key) ? '，Z 为复位' : ''}
            </footer>
          )}
        </section>

        <div className="vb-side">
          {map && hasUart && (
            <UartTerminal
              hasTx={!!map.uartTx}
              hasRx={!!map.uartRx}
              txName={map.uartTx?.name ?? null}
              rxName={map.uartRx?.ref.name ?? null}
              baud={baud}
              onBaud={setBaud}
              bitPeriod={bitPeriod(freqMHz * 1e6, baud)}
              rxPending={snap?.rxPending ?? 0}
              running={sim.running}
              subscribe={sim.onUart}
              onSend={sim.uartSend}
              onClearQueue={sim.uartClear}
            />
          )}
          {map && <ProbePanel map={map} values={values} inputs={inputs} onSetInput={setInput} />}
        </div>
      </div>
    </>,
  );
}
