// One interface in front of the model. Two transports:
//  - direct:  the user's own Anthropic key, streamed from the panel (dogfood/dev)
//  - airdial: AirDial backend /v1/messages, which holds the real key, meters
//             cost per user and can swap providers (backend/app/gateway.py).

import Anthropic from '@anthropic-ai/sdk';
import type { Settings } from '../store/types';

export type MessageParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type Message = Anthropic.Beta.BetaMessage;

export const BETAS: Anthropic.Beta.AnthropicBeta[] = [
  // Server-side refusal fallback, routed by refusal category.
  'server-side-fallback-2026-07-01',
  // Short progress notes between tool calls, shown in the task log.
  'thinking-display-updates-2026-08-18',
];

export interface Gateway {
  create(params: MessageParams, opts: { signal?: AbortSignal; onText?: (delta: string) => void }): Promise<Message>;
}

export class GatewayConfigError extends Error {}

export function makeGateway(settings: Settings): Gateway {
  const g = settings.gateway;
  if (g.mode === 'direct') {
    if (!g.apiKey) throw new GatewayConfigError('Add your Anthropic API key in Settings, or switch to the AirDial backend.');
    const client = new Anthropic({ apiKey: g.apiKey, dangerouslyAllowBrowser: true, maxRetries: 3 });
    return {
      async create(params, { signal, onText }) {
        const stream = client.beta.messages.stream({ ...params, betas: BETAS }, { signal });
        if (onText) stream.on('text', onText);
        return stream.finalMessage();
      },
    };
  }
  if (!g.backendUrl || !g.backendToken) throw new GatewayConfigError('Sign in to AirDial (backend URL and token) in Settings.');
  // The backend speaks the Messages API shape at /v1/messages, so the SDK
  // talks to it directly; the AirDial token goes in the api-key header.
  const client = new Anthropic({ apiKey: g.backendToken, baseURL: g.backendUrl.replace(/\/$/, ''), dangerouslyAllowBrowser: true, maxRetries: 2 });
  return {
    async create(params, { signal }) {
      return client.beta.messages.create({ ...params, betas: BETAS }, { signal });
    },
  };
}

// Opus 5.5 list prices, $ per million tokens, for the cost-per-task readout.
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function costOf(model: string, usage: Anthropic.Beta.BetaUsage): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']!;
  return (
    (usage.input_tokens * p.in +
      usage.output_tokens * p.out +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  );
}
