import type { Example } from '@webeda/shared';
import { PLAYGROUND_EXAMPLES } from './playground';
import { STUDIO_TEMPLATES } from './templates';

/**
 * 内置示例与工程模板。
 * - Playground 示例（scope = 'playground'）：设计 + 自检测试平台，见 playground.ts；
 * - Studio 模板（scope = 'studio'，category = 'board'）：带板卡、约束与工程设置，见 templates.ts。
 * HDL 源文件位于 hdl/<id>/，由 verify.ts 用 Icarus / Yosys / nextpnr 逐一验证。
 * 第一个示例固定为 'counter'（Playground 的默认示例）。
 */
export const EXAMPLES: Example[] = [...PLAYGROUND_EXAMPLES, ...STUDIO_TEMPLATES];

export function getExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export { PLAYGROUND_EXAMPLES, STUDIO_TEMPLATES };
