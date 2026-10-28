import type { JobKind } from '@webeda/shared';
import type { Flow } from '../jobs/context';
import { elaborate } from './elaborate';
import { gatesim } from './gatesim';
import { implement } from './implement';
import { simulate } from './simulate';
import { synthesize } from './synthesize';
import { yosys } from './yosys';

/** 每种 JobKind 对应一个 flow（由 jobs/manager.ts 调用） */
export const FLOWS: { [K in JobKind]: Flow<K> } = {
  simulate,
  elaborate,
  synthesize,
  implement,
  gatesim,
  yosys,
};
