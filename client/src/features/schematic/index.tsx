// 原理图查看器 + FPGA 器件视图。对外只暴露这里的组件与类型。
// TODO(schematic agent): 替换为真正实现，可在本目录新增任意文件。
import type { PlacementInfo } from '@webeda/shared';

export interface SchematicViewerProps {
  /** netlistsvg 生成的 SVG 文本；null = 暂无 */
  svg: string | null;
  loading?: boolean;
  /** 显示在工具栏上的标题，如模块名 */
  title?: string;
  /** 可切换的模块列表（层次化原理图）；选择后回调 */
  modules?: string[];
  currentModule?: string;
  onSelectModule?: (module: string) => void;
  className?: string;
}

export function SchematicViewer({ svg, loading }: SchematicViewerProps) {
  return <div className="placeholder">{loading ? '生成中…' : svg ? '原理图' : '暂无原理图'}</div>;
}

export interface DeviceViewProps {
  placement: PlacementInfo | null;
  loading?: boolean;
  className?: string;
}

/** 器件视图（类 Vivado Device 窗口）：画出 FPGA tile 网格与已占用的逻辑单元 */
export function DeviceView({ placement, loading }: DeviceViewProps) {
  return <div className="placeholder">{loading ? '实现中…' : placement ? `${placement.cells.length} cells` : '运行实现后显示器件视图'}</div>;
}
