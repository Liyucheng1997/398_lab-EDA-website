// 原理图查看器 + FPGA 器件视图 + 模块层次树。对外只暴露这里的组件与类型。
export { SchematicViewer } from './SchematicViewer';
export type { SchematicViewerProps, SchematicSelection } from './SchematicViewer';
export { DeviceView } from './DeviceView';
export type { DeviceViewProps } from './DeviceView';
export { HierarchyTree } from './HierarchyTree';
export type { HierarchyTreeProps } from './HierarchyTree';
/** SVG 清洗（供其他需要内联第三方 SVG 的模块复用） */
export { parseSvg, sanitizeTree, SvgParseError } from './sanitize';
