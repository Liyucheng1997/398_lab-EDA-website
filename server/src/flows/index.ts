import type { Flow } from '../jobs/context';
import { FlowError } from '../jobs/context';

// TODO(flows agent): 用真正的实现替换这些占位 flow，每个 flow 一个文件：
//   simulate.ts / elaborate.ts / synthesize.ts / implement.ts / gatesim.ts / yosys.ts
const notImplemented: Flow = async () => {
  throw new FlowError('该流程尚未实现');
};

export const FLOWS: { [K in import('@webeda/shared').JobKind]: Flow<K> } = {
  simulate: notImplemented as Flow<'simulate'>,
  elaborate: notImplemented as Flow<'elaborate'>,
  synthesize: notImplemented as Flow<'synthesize'>,
  implement: notImplemented as Flow<'implement'>,
  gatesim: notImplemented as Flow<'gatesim'>,
  yosys: notImplemented as Flow<'yosys'>,
};
