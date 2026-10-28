// 波形查看器（类 EPWave / GTKWave）。对外只暴露这里的组件与类型。
// TODO(waveform agent): 替换为真正实现，可在本目录新增任意文件（parser、canvas 渲染、worker 等）。

export interface WaveformViewerProps {
  /** VCD 文本；null = 还没有波形 */
  vcd: string | null;
  /** 加载中（任务运行中）时显示占位 */
  loading?: boolean;
  /** 初次加载时默认添加的信号（层次名，如 "tb.dut.q"）；缺省时自动添加顶层前若干信号 */
  initialSignals?: string[];
  /** 同一个 key 在重新运行后保留用户已添加的信号列表与缩放 */
  persistKey?: string;
  className?: string;
}

export function WaveformViewer({ vcd, loading }: WaveformViewerProps) {
  return <div className="placeholder">{loading ? '仿真中…' : vcd ? `VCD ${vcd.length} 字节` : '暂无波形'}</div>;
}
