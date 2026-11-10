// 电路板（PCB）查看器。对外只暴露这里的组件、类型与派生数据函数。
export { PcbBoardView } from './PcbBoardView';
export type { PcbBoardViewProps } from './PcbBoardView';
export { VIOLATION_LABELS, bomCsv, bomRows, compareRefs, designToSvg, downloadText, pcbStats, safeBoardFileName } from './model';
export type { BomRow, PcbStats } from './model';
