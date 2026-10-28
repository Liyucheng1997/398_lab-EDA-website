// 虚拟开发板：在浏览器里对门级网表做周期仿真，用 LED/开关/按键/数码管交互。
// TODO(board agent): 替换为真正实现，可在本目录新增任意文件（仿真内核、worker、外设组件等）。
import type { BoardInfo, GateNetlist } from '@webeda/shared';

export interface VirtualBoardProps {
  /** gatesim 任务产出的门级网表；null = 还没构建 */
  netlist: GateNetlist | null;
  /** 板卡信息（决定外设数量与时钟频率显示）；缺省时根据端口名自动推断外设 */
  board?: BoardInfo;
  /** 用户点击“构建/重新构建”时回调（页面负责跑 gatesim 任务并传回 netlist） */
  onBuild?: () => void;
  building?: boolean;
  className?: string;
}

export function VirtualBoard({ netlist, building }: VirtualBoardProps) {
  return <div className="placeholder">{building ? '构建中…' : netlist ? `${netlist.stats.gates} gates` : '点击构建以加载设计'}</div>;
}
