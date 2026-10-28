/** 首页单色流体背景（fluid.js 的类型声明）。不支持 WebGL 时返回 null。 */
export interface FluidHandle {
  start(): void;
  stop(): void;
  /** 停止动画并移除 target 上的指针监听 */
  destroy(): void;
}

export function createFluid(canvas: HTMLCanvasElement, target?: HTMLElement): FluidHandle | null;
