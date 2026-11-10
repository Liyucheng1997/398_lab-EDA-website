/**
 * Claude API 接入：默认用 Claude Fable 5.2 驱动电路板设计。
 * 凭据由 SDK 从环境解析（ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` 的 profile）。
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PcbAiStatus } from '@webeda/shared';
import { config } from '../config';
import { SYSTEM_PROMPT, type CallModel } from './agent';
import { PCB_TOOLS } from './tools';

function hasCredentials(): boolean {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return true;
  if (process.env.ANTHROPIC_FEDERATION_RULE_ID && (process.env.ANTHROPIC_IDENTITY_TOKEN_FILE || process.env.ANTHROPIC_IDENTITY_TOKEN)) return true;
  return fs.existsSync(path.join(os.homedir(), '.config', 'anthropic'));
}

export function aiStatus(): PcbAiStatus {
  const available = hasCredentials();
  return {
    available,
    model: config.ai.model,
    effort: config.ai.effort,
    reason: available ? undefined : '服务端没有配置 Claude API 凭据：请设置环境变量 ANTHROPIC_API_KEY 后重启服务端',
  };
}

/** 拒答时可由服务端自动换模型重试的模型（见 Anthropic 文档 refusals-and-fallback） */
function supportsServerFallback(model: string): boolean {
  return /^claude-(fable|opus)-5(-|$)/.test(model) || model === 'claude-sonnet-5-5';
}

function toolParams(): Anthropic.Beta.BetaTool[] {
  return PCB_TOOLS.map((t) => {
    const { $schema: _schema, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Beta.BetaTool['input_schema'],
      // 流式请求下让工具参数边生成边下发；参数由 executeTool 用 schema 校验
      eager_input_streaming: true,
    };
  });
}

export function createClaudeCaller(): CallModel {
  const client = new Anthropic();
  const tools = toolParams();
  const { model, effort } = config.ai;
  const fallback = supportsServerFallback(model);
  return async (messages, hooks, signal) => {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        system: SYSTEM_PROMPT,
        tools,
        messages,
        // Fable 5.2 的思考始终开启；display 只决定是否返回思考摘要
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort },
        // 每轮自动缓存到最后一个可缓存块：智能体循环里前缀逐轮增长，命中率高
        cache_control: { type: 'ephemeral' },
        // 安全分类器误拒时由服务端换模型重跑同一请求
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    stream.on('text', (delta) => hooks.onText(delta));
    stream.on('thinking', (delta) => hooks.onThinking(delta));
    return stream.finalMessage();
  };
}

/** 把 SDK 的异常翻译成给用户看的中文 */
export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API 凭据无效，请检查服务端的 ANTHROPIC_API_KEY';
  if (err instanceof Anthropic.PermissionDeniedError) return `当前 API 凭据无权使用模型 ${config.ai.model}：${err.message}`;
  if (err instanceof Anthropic.NotFoundError) return `模型 ${config.ai.model} 不存在或不可用：${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return 'Claude API 触发了速率限制，请稍后再试';
  if (err instanceof Anthropic.BadRequestError) return `Claude API 拒绝了请求：${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return '无法连接 Claude API，请检查服务端的网络';
  if (err instanceof Anthropic.APIError) return `Claude API 错误（${err.status ?? '未知状态'}）：${err.message}`;
  return (err as Error).message || '未知错误';
}
