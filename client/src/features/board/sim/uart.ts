/**
 * 以「时钟周期」为时间单位的 UART 8N1 编解码器。
 * 每位持续 period = 设计时钟频率 / 波特率 个周期（可以是小数，按浮点累积，长时间不漂移）。
 */

/** 每位的周期数 */
export function bitPeriod(freqHz: number, baud: number): number {
  if (!(freqHz > 0) || !(baud > 0)) return 0;
  return freqHz / baud;
}

/**
 * 解码设计的 TX 输出：检测起始位下降沿，在每位中点采样，
 * 停止位不为 1 时记为帧错误（仍输出该字节）。
 */
export class UartDecoder {
  period: number;
  private prev = 1;
  private busy = false;
  private nextSample = 0;
  /** -1 = 起始位，0..7 = 数据位，8 = 停止位 */
  private bitIdx = -1;
  private shift = 0;
  constructor(
    period: number,
    private readonly onByte: (byte: number, framingError: boolean) => void,
  ) {
    this.period = period;
  }

  reset(): void {
    this.prev = 1;
    this.busy = false;
    this.bitIdx = -1;
    this.shift = 0;
  }

  /** 每个周期调用一次：level 为该周期 TX 线电平，cycle 为周期序号（单调递增） */
  sample(level: number, cycle: number): void {
    if (!this.busy) {
      if (this.prev === 1 && level === 0 && this.period >= 1) {
        this.busy = true;
        this.bitIdx = -1;
        this.shift = 0;
        // 下降沿发生在 cycle-1 与 cycle 之间，起始位中点约在 cycle - 0.5 + period/2
        this.nextSample = cycle - 0.5 + this.period / 2;
      }
      this.prev = level;
      return;
    }
    this.prev = level;
    if (cycle < this.nextSample) return;
    if (this.bitIdx === -1) {
      if (level !== 0) {
        // 毛刺：不是有效起始位
        this.busy = false;
        return;
      }
      this.bitIdx = 0;
    } else if (this.bitIdx < 8) {
      if (level) this.shift |= 1 << this.bitIdx;
      this.bitIdx++;
    } else {
      this.onByte(this.shift, level !== 1);
      this.busy = false;
      return;
    }
    this.nextSample += this.period;
  }
}

/** 驱动设计的 RX 输入：把排队的字节按 8N1 帧串行化 */
export class UartEncoder {
  period: number;
  private queue: number[] = [];
  private head = 0;
  private framing = false;
  private frameStart = 0;
  private frameBits = 0;

  constructor(period: number) {
    this.period = period;
  }

  get pending(): number {
    return this.queue.length - this.head + (this.framing ? 1 : 0);
  }

  get busy(): boolean {
    return this.framing || this.head < this.queue.length;
  }

  enqueue(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.queue.push(bytes[i] & 0xff);
  }

  clear(): void {
    this.queue = [];
    this.head = 0;
    this.framing = false;
  }

  /** 第 cycle 个周期的 RX 线电平 */
  level(cycle: number): 0 | 1 {
    if (!this.framing) {
      if (this.head >= this.queue.length || this.period < 1) return 1;
      const byte = this.queue[this.head++];
      if (this.head > 4096 && this.head * 2 > this.queue.length) {
        this.queue = this.queue.slice(this.head);
        this.head = 0;
      }
      this.framing = true;
      this.frameStart = cycle;
      // 位 0 = 起始(0)，1..8 = 数据（LSB 先），9 = 停止(1)
      this.frameBits = (byte << 1) | (1 << 9);
    }
    const j = Math.floor((cycle - this.frameStart) / this.period);
    if (j >= 10) {
      this.framing = false;
      // 紧接着发送下一字节（若有）
      const nextStart = this.frameStart + 10 * this.period;
      if (this.head < this.queue.length) {
        const byte = this.queue[this.head++];
        this.framing = true;
        this.frameStart = nextStart;
        this.frameBits = (byte << 1) | (1 << 9);
        const k = Math.floor((cycle - this.frameStart) / this.period);
        return k < 0 ? 1 : ((this.frameBits >> Math.min(k, 9)) & 1) as 0 | 1;
      }
      return 1;
    }
    return ((this.frameBits >> j) & 1) as 0 | 1;
  }
}
