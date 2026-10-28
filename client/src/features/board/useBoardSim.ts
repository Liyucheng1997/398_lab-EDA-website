/**
 * useBoardSim：创建仿真 Worker（不可用时回退到主线程），加载网表、转发控制命令、接收快照。
 * 输入电平按位名保存在主线程，重新构建后自动恢复开关位置。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardInfo, GateNetlist } from '@webeda/shared';
import { mapBoard, type BoardMap } from './sim/peripherals';
import { SimHost } from './sim/host';
import type { FromWorker, LoadInfo, SimSpeed, Snapshot, ToWorker } from './sim/protocol';

export type UartListener = (bytes: number[], framingErrors: number) => void;

export interface BoardSim {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  info: LoadInfo | null;
  snap: Snapshot | null;
  map: BoardMap | null;
  /** 当前输入电平（扁平下标 → 0/1），用于开关/按键即时显示 */
  inputs: Record<number, number>;
  /** 'worker' | 'main'（Worker 不可用时在主线程仿真） */
  engine: 'worker' | 'main';
  speed: SimSpeed;
  running: boolean;
  run(): void;
  pause(): void;
  toggle(): void;
  step(cycles: number): void;
  reset(): void;
  setSpeed(speed: SimSpeed): void;
  setInput(index: number, level: number): void;
  uartSend(bytes: number[]): void;
  uartClear(): void;
  onUart(fn: UartListener): () => void;
}

interface Channel {
  post(msg: ToWorker): void;
  dispose(): void;
  engine: 'worker' | 'main';
}

function mainThreadChannel(onMsg: (m: FromWorker) => void): Channel {
  let alive = true;
  const host = new SimHost(
    (m) => {
      if (alive) onMsg(m);
    },
    undefined,
    { budgetMs: 8 },
  );
  return {
    engine: 'main',
    post: (msg) => host.handle(msg),
    dispose: () => {
      alive = false;
      host.dispose();
    },
  };
}

function workerChannel(onMsg: (m: FromWorker) => void, onFail: () => void, onCrash: (message: string) => void): Channel | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./sim/sim.worker.ts', import.meta.url), { type: 'module', name: 'webeda-board-sim' });
    let gotMessage = false;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      gotMessage = true;
      onMsg(e.data);
    };
    w.onerror = (e) => {
      e.preventDefault();
      // 脚本加载失败（还没收到任何消息）→ 回退主线程
      if (!gotMessage) onFail();
      else onCrash(e.message || '仿真 Worker 出错');
    };
    return {
      engine: 'worker',
      post: (msg) => w.postMessage(msg),
      dispose: () => w.terminate(),
    };
  } catch {
    return null;
  }
}

const SPEED_KEY = 'webeda.board.speed';
const EMPTY_INPUTS: Record<number, number> = {};

function loadSpeed(): SimSpeed {
  try {
    const s = localStorage.getItem(SPEED_KEY);
    if (s === 'max') return 'max';
    const n = Number(s);
    if (s && Number.isFinite(n) && n > 0) return n;
  } catch {
    /* ignore */
  }
  return 'max';
}

export function useBoardSim(netlist: GateNetlist | null, board: BoardInfo | undefined, freqHz: number, baud: number): BoardSim {
  const [status, setStatus] = useState<BoardSim['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  // 快照 / 网表信息 / 输入电平都记下所属网表，切换网表的那一帧不会把旧下标套到新映射上
  const [infoSt, setInfo] = useState<{ nl: GateNetlist | null; info: LoadInfo } | null>(null);
  const [snapSt, setSnap] = useState<{ nl: GateNetlist | null; snap: Snapshot } | null>(null);
  const [inputsSt, setInputs] = useState<{ nl: GateNetlist | null; levels: Record<number, number> }>({ nl: null, levels: {} });
  const [speed, setSpeedState] = useState<SimSpeed>(loadSpeed);
  const [engine, setEngine] = useState<'worker' | 'main'>('worker');

  const chan = useRef<Channel | null>(null);
  const uartSubs = useRef(new Set<UartListener>());
  /** 按位名保存的输入电平（跨重新构建保留） */
  const savedInputs = useRef<Record<string, number>>({});
  /** 当前加载序号及其网表 */
  const gen = useRef(0);
  const genNetlist = useRef<GateNetlist | null>(null);
  const userPaused = useRef(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const cfgRef = useRef({ freqHz, baud });
  cfgRef.current = { freqHz, baud };

  const map = useMemo(() => {
    if (!netlist) return null;
    try {
      return mapBoard(netlist, board);
    } catch {
      return null;
    }
  }, [netlist, board]);
  const mapRef = useRef(map);
  mapRef.current = map;

  const onMsg = useCallback((m: FromWorker) => {
    // 丢弃旧网表的迟到消息
    if ((m.type === 'snapshot' ? m.snap.gen : m.gen) !== gen.current) return;
    const nl = genNetlist.current;
    if (m.type === 'loaded') {
      setInfo({ nl, info: m.info });
      setStatus('ready');
      setError(null);
    } else if (m.type === 'error') {
      setError(m.message);
      setStatus('error');
    } else {
      const s = m.snap;
      if (s.uart.length || s.uartErrors) for (const fn of uartSubs.current) fn(s.uart, s.uartErrors);
      setSnap({ nl, snap: s });
    }
  }, []);

  // 创建通道（组件生命周期内复用）
  useEffect(() => {
    let disposed = false;
    const fallback = () => {
      if (disposed) return;
      chan.current?.dispose();
      chan.current = mainThreadChannel(onMsg);
      // engine 变化会触发下方的加载 effect，把网表重新发给主线程仿真
      setEngine('main');
    };
    const crash = (message: string) => {
      if (disposed) return;
      setError(message);
      setStatus('error');
    };
    const c = workerChannel(onMsg, fallback, crash) ?? mainThreadChannel(onMsg);
    chan.current = c;
    setEngine(c.engine);
    return () => {
      disposed = true;
      chan.current?.dispose();
      chan.current = null;
    };
  }, [onMsg]);

  // 加载网表
  useEffect(() => {
    const c = chan.current;
    gen.current += 1;
    genNetlist.current = netlist;
    if (!netlist || !c) {
      setStatus('idle');
      setSnap(null);
      setInfo(null);
      if (c) c.post({ type: 'pause' });
      return;
    }
    const m = mapRef.current;
    // 当前输入电平：保存值优先，否则为外设默认电平
    const levels: Record<number, number> = {};
    const byName: Record<string, number> = {};
    if (m) {
      for (const ctl of m.inputs) {
        const saved = savedInputs.current[ctl.ref.name];
        // 按键/复位每次加载都回到释放状态
        const lv = saved !== undefined && (ctl.kind === 'switch' || ctl.kind === 'generic') ? saved : ctl.idle;
        levels[ctl.ref.index] = lv;
        byName[ctl.ref.name] = lv;
      }
    }
    setInputs({ nl: netlist, levels });
    setSnap(null);
    setInfo(null);
    setStatus('loading');
    setError(null);
    const msg: ToWorker = {
      type: 'load',
      gen: gen.current,
      netlist,
      board,
      freqHz: cfgRef.current.freqHz,
      baud: cfgRef.current.baud,
      inputs: byName,
      run: !userPaused.current,
      speed: speedRef.current,
    };
    c.post(msg);
  }, [netlist, board, engine]);

  // 配置变化
  useEffect(() => {
    chan.current?.post({ type: 'config', freqHz, baud });
  }, [freqHz, baud]);

  const post = useCallback((msg: ToWorker) => chan.current?.post(msg), []);

  const snap = snapSt && snapSt.nl === netlist ? snapSt.snap : null;
  const info = infoSt && infoSt.nl === netlist ? infoSt.info : null;
  const inputs = inputsSt.nl === netlist ? inputsSt.levels : EMPTY_INPUTS;
  const running = snap ? snap.mode !== 'paused' : false;

  const run = useCallback(() => {
    userPaused.current = false;
    post({ type: 'run', speed: speedRef.current });
  }, [post]);
  const pause = useCallback(() => {
    userPaused.current = true;
    post({ type: 'pause' });
  }, [post]);
  const toggle = useCallback(() => (running ? pause() : run()), [running, pause, run]);
  const step = useCallback(
    (cycles: number) => {
      userPaused.current = true;
      post({ type: 'step', cycles });
    },
    [post],
  );
  const reset = useCallback(() => post({ type: 'reset' }), [post]);
  const setSpeed = useCallback(
    (s: SimSpeed) => {
      setSpeedState(s);
      try {
        localStorage.setItem(SPEED_KEY, String(s));
      } catch {
        /* ignore */
      }
      post({ type: 'speed', speed: s });
    },
    [post],
  );
  const setInput = useCallback(
    (index: number, level: number) => {
      const m = mapRef.current;
      const l = level ? 1 : 0;
      const ref = m?.bits[index];
      if (ref) savedInputs.current[ref.name] = l;
      setInputs((prev) => (prev.nl !== genNetlist.current || prev.levels[index] === l ? prev : { nl: prev.nl, levels: { ...prev.levels, [index]: l } }));
      post({ type: 'setInput', index, level: l });
    },
    [post],
  );
  const uartSend = useCallback((bytes: number[]) => post({ type: 'uartSend', bytes }), [post]);
  const uartClear = useCallback(() => post({ type: 'uartClear' }), [post]);
  const onUart = useCallback((fn: UartListener) => {
    uartSubs.current.add(fn);
    return () => void uartSubs.current.delete(fn);
  }, []);

  return {
    status,
    error,
    info,
    snap,
    map,
    inputs,
    engine,
    speed,
    running,
    run,
    pause,
    toggle,
    step,
    reset,
    setSpeed,
    setInput,
    uartSend,
    uartClear,
    onUart,
  };
}
