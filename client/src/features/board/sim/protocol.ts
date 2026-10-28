/** 主线程 ⇄ 仿真 Worker 的消息协议 */
import type { BoardInfo, GateNetlist } from '@webeda/shared';

/** 目标速度：每秒周期数，或 'max' 尽可能快 */
export type SimSpeed = number | 'max';

export type SimMode = 'paused' | 'running' | 'stepping';

export type ToWorker =
  | {
      type: 'load';
      /** 加载序号：之后的消息都带上它，主线程据此丢弃旧网表的迟到消息 */
      gen: number;
      netlist: GateNetlist;
      board?: BoardInfo;
      freqHz: number;
      baud: number;
      /** 按位名恢复输入电平（重新构建后保留开关位置） */
      inputs?: Record<string, number>;
      /** 载入后是否自动运行 */
      run: boolean;
      speed: SimSpeed;
    }
  | { type: 'setInput'; index: number; level: number }
  | { type: 'run'; speed?: SimSpeed }
  | { type: 'speed'; speed: SimSpeed }
  | { type: 'pause' }
  | { type: 'step'; cycles: number }
  | { type: 'reset' }
  | { type: 'uartSend'; bytes: number[] }
  | { type: 'uartClear' }
  | { type: 'config'; freqHz?: number; baud?: number };

export interface LoadInfo {
  compiled: boolean;
  gates: number;
  flipflops: number;
  latches: number;
  clockNets: number;
  loopMode: boolean;
  compileMs: number;
}

export interface Snapshot {
  /** 对应的加载序号 */
  gen: number;
  /** 递增序号 */
  seq: number;
  mode: SimMode;
  speed: SimSpeed;
  cycles: number;
  /** 实测周期/秒（运行时） */
  achievedHz: number;
  /** 实测门求值/秒 */
  gateEvalsPerSec: number;
  values: Uint8Array;
  duty: Float32Array;
  segJoint: Float32Array | null;
  uart: number[];
  uartErrors: number;
  rxPending: number;
  oscillating: boolean;
  /** 单步剩余周期 */
  stepRemaining: number;
}

export type FromWorker =
  | { type: 'loaded'; gen: number; info: LoadInfo }
  | { type: 'error'; gen: number; message: string }
  | { type: 'snapshot'; snap: Snapshot };
