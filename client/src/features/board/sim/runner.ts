/**
 * SimRunner：在 Simulator 之上实现「开发板」语义——时钟驱动、输入、
 * 输出占空比统计（LED 亮度 / 数码管余辉）、串口收发。与 Worker / DOM 无关，可直接单测。
 */
import type { BoardInfo, GateNetlist } from '@webeda/shared';
import { Simulator, type KernelOptions } from './kernel';
import { mapBoard, type BoardMap } from './peripherals';
import { UartDecoder, UartEncoder, bitPeriod } from './uart';

export interface RunnerConfig {
  /** 设计时钟频率（Hz），用于波特率换算 */
  freqHz: number;
  baud: number;
}

export interface RunnerSnapshot {
  cycles: number;
  /** 所有端口位的当前值（扁平下标见 BoardMap.bits） */
  values: Uint8Array;
  /** 自上次快照以来各位为 1 的周期占比（无周期推进时等于当前值） */
  duty: Float32Array;
  /** 数码管：位选 d 与段 s 同时为 1 的周期占比，下标 d*8+s；没有多路数码管时为 null */
  segJoint: Float32Array | null;
  /** 自上次快照以来串口收到的字节 */
  uart: number[];
  uartErrors: number;
  /** 待发送到 RX 的字节数 */
  rxPending: number;
  oscillating: boolean;
  /** 累计组合门求值次数 */
  gateEvals: number;
  /** 本窗口内推进的周期数 */
  windowCycles: number;
}

export class SimRunner {
  readonly sim: Simulator;
  readonly map: BoardMap;
  cycles = 0;
  private cfg: RunnerConfig;
  /** 每个扁平位的输入电平（只对输入有意义） */
  private readonly levels: Uint8Array;
  private readonly clockNets: Int32Array;
  /** 需要统计占空比的输出位：扁平下标与 net */
  private readonly outIdx: Int32Array;
  private readonly outNet: Int32Array;
  private readonly acc: Float64Array;
  private readonly segSegNet: Int32Array;
  private readonly segAnNet: Int32Array;
  private readonly joint: Float64Array | null;
  private winCycles = 0;
  private readonly decoder: UartDecoder | null;
  private readonly encoder: UartEncoder | null;
  private readonly txNet: number;
  private readonly rxNet: number;
  private uartOut: number[] = [];
  private uartErr = 0;

  constructor(netlist: GateNetlist, board: BoardInfo | undefined, cfg: RunnerConfig, kopts?: KernelOptions) {
    this.sim = new Simulator(netlist, kopts);
    this.map = mapBoard(netlist, board);
    this.cfg = { ...cfg };
    const m = this.map;
    this.levels = new Uint8Array(m.totalBits);
    for (const c of m.inputs) this.levels[c.ref.index] = c.idle;
    this.clockNets = Int32Array.from(m.clocks.map((c) => c.net));

    const outs = m.bits.filter((b) => m.ports[b.port].direction !== 'input');
    this.outIdx = Int32Array.from(outs.map((b) => b.index));
    this.outNet = Int32Array.from(outs.map((b) => b.net));
    this.acc = new Float64Array(outs.length);

    const mux = m.segMux;
    if (mux && mux.digits.length > 0) {
      // 缺失的段用 net 0（恒 0）占位
      this.segSegNet = Int32Array.from(mux.segs.map((s) => (s ? s.net : 0)));
      this.segAnNet = Int32Array.from(mux.digits.map((d) => d.net));
      this.joint = new Float64Array(mux.digits.length * 8);
    } else {
      this.segSegNet = new Int32Array(0);
      this.segAnNet = new Int32Array(0);
      this.joint = null;
    }

    const period = bitPeriod(cfg.freqHz, cfg.baud);
    this.txNet = m.uartTx ? m.uartTx.net : -1;
    this.rxNet = m.uartRx ? m.uartRx.ref.net : -1;
    this.decoder = m.uartTx
      ? new UartDecoder(period, (b, err) => {
          if (this.uartOut.length < 1_000_000) this.uartOut.push(b);
          if (err) this.uartErr++;
        })
      : null;
    this.encoder = m.uartRx ? new UartEncoder(period) : null;

    this.reset();
  }

  get config(): RunnerConfig {
    return { ...this.cfg };
  }

  configure(cfg: Partial<RunnerConfig>): void {
    if (cfg.freqHz !== undefined && cfg.freqHz > 0) this.cfg.freqHz = cfg.freqHz;
    if (cfg.baud !== undefined && cfg.baud > 0) this.cfg.baud = cfg.baud;
    const p = bitPeriod(this.cfg.freqHz, this.cfg.baud);
    if (this.decoder) {
      this.decoder.period = p;
      this.decoder.reset();
    }
    if (this.encoder) this.encoder.period = p;
  }

  /** 当前每位周期数（UI 提示用） */
  get uartBitPeriod(): number {
    return bitPeriod(this.cfg.freqHz, this.cfg.baud);
  }

  /** 重新上电：寄存器回到初值，保留输入电平 */
  reset(): void {
    const inputs: [number, number][] = [];
    for (const c of this.map.inputs) inputs.push([c.ref.net, this.levels[c.ref.index]]);
    for (const n of this.clockNets) inputs.push([n, 0]);
    this.sim.reset(inputs);
    this.cycles = 0;
    this.winCycles = 0;
    this.acc.fill(0);
    this.joint?.fill(0);
    this.decoder?.reset();
    this.encoder?.clear();
    this.uartOut = [];
    this.uartErr = 0;
  }

  /** 设置输入（扁平下标）；立即求值（可能触发以按键为时钟的触发器） */
  setInput(index: number, level: number): void {
    const b = this.map.bits[index];
    if (!b || this.map.ports[b.port].direction !== 'input') return;
    if (this.clockNets.includes(b.net)) return;
    const l = level ? 1 : 0;
    this.levels[index] = l;
    if (this.sim.setNet(b.net, l)) this.sim.settle(true);
  }

  /** 按位名（如 "sw[3]"）批量恢复输入 */
  setInputsByName(levels: Record<string, number>): void {
    for (const c of this.map.inputs) {
      const v = levels[c.ref.name];
      if (v !== undefined) this.setInput(c.ref.index, v);
    }
  }

  inputLevel(index: number): number {
    return this.levels[index];
  }

  uartSend(bytes: ArrayLike<number>): void {
    this.encoder?.enqueue(bytes);
  }

  uartClearQueue(): void {
    this.encoder?.clear();
  }

  /** 推进 n 个时钟周期 */
  runCycles(n: number): void {
    const sim = this.sim;
    const v = sim.v;
    const clk = this.clockNets;
    const hasClk = clk.length > 0;
    const outNet = this.outNet;
    const acc = this.acc;
    const no = outNet.length;
    const joint = this.joint;
    const segNet = this.segSegNet;
    const anNet = this.segAnNet;
    const nd = anNet.length;
    const enc = this.encoder;
    const dec = this.decoder;
    const rx = this.rxNet;
    const tx = this.txNet;
    let cycle = this.cycles;
    for (let i = 0; i < n; i++) {
      if (enc !== null) {
        const l = enc.level(cycle);
        if (v[rx] !== l) {
          v[rx] = l;
          sim.settle(true);
        }
      }
      if (hasClk) {
        sim.drive(clk, 0);
        sim.drive(clk, 1);
      }
      for (let k = 0; k < no; k++) acc[k] += v[outNet[k]];
      if (joint !== null) {
        for (let d = 0; d < nd; d++) {
          if (v[anNet[d]]) {
            const o = d * 8;
            for (let s = 0; s < 8; s++) joint[o + s] += v[segNet[s]];
          }
        }
      }
      if (dec !== null) dec.sample(v[tx], cycle);
      cycle++;
    }
    this.cycles = cycle;
    this.winCycles += n;
  }

  /** 生成快照并清空统计窗口 */
  snapshot(): RunnerSnapshot {
    const m = this.map;
    const v = this.sim.v;
    const values = new Uint8Array(m.totalBits);
    for (const b of m.bits) values[b.index] = v[b.net];
    const duty = new Float32Array(m.totalBits);
    for (let i = 0; i < values.length; i++) duty[i] = values[i];
    const w = this.winCycles;
    if (w > 0) for (let k = 0; k < this.outIdx.length; k++) duty[this.outIdx[k]] = this.acc[k] / w;
    let segJoint: Float32Array | null = null;
    if (this.joint) {
      const nd = this.segAnNet.length;
      segJoint = new Float32Array(nd * 8);
      for (let d = 0; d < nd; d++) {
        for (let s = 0; s < 8; s++) {
          segJoint[d * 8 + s] = w > 0 ? this.joint[d * 8 + s] / w : v[this.segAnNet[d]] & v[this.segSegNet[s]];
        }
      }
      // 段缺失（占位 net 0）时恒为 0
      this.joint.fill(0);
    }
    this.acc.fill(0);
    this.winCycles = 0;
    const uart = this.uartOut;
    this.uartOut = [];
    const uartErrors = this.uartErr;
    this.uartErr = 0;
    return {
      cycles: this.cycles,
      values,
      duty,
      segJoint,
      uart,
      uartErrors,
      rxPending: this.encoder?.pending ?? 0,
      oscillating: this.sim.oscillating,
      gateEvals: this.sim.gateEvals,
      windowCycles: w,
    };
  }
}
