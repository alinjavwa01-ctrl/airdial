// One interface in front of the model. Two transports:
//  - airdial: the AirDial service (/v1/messages). Customers use this. It is sent
//             a mode ("best"/"fast"), picks the provider and model, fails over
//             between providers, meters cost (backend/app/gateway.py).
//  - direct:  a developer's own Anthropic key, streamed from the panel.

import Anthropic from '@anthropic-ai/sdk';
import type { Settings } from '../store/types';
import { AuthError, airdialToken } from '../auth/session';

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
  if (!g.backendUrl || (!g.backendToken && !g.session)) throw new GatewayConfigError('Sign in to AirDial in Settings to start.');
  // The AirDial service speaks the same message format at /v1/messages, so the SDK talks to it
  // directly. It receives only a mode and the conversation; it chooses the model and provider.
  return {
    async create(params, { signal }) {
      const client = new Anthropic({ apiKey: await airdialToken(), baseURL: g.backendUrl.replace(/\/$/, ''), dangerouslyAllowBrowser: true, maxRetries: 2 });
      const { max_tokens, system, tools, messages } = params;
      return client.beta.messages.create({ model: `airdial-${g.agentMode}`, max_tokens, system, tools, messages }, { signal });
    },
  };
}

/**
 * What the customer sees when a model call fails. On an AirDial account the
 * service already returns AirDial wording; we never show raw vendor errors.
 * Developers on their own key get the raw message.
 */
export function friendlyError(e: unknown, mode: Settings['gateway']['mode']): string {
  if (e instanceof GatewayConfigError || e instanceof AuthError) return e.message;
  if (mode === 'direct') return (e as Error)?.message ?? String(e);
  if (e instanceof Anthropic.AuthenticationError) return 'Your AirDial sign-in has expired. Sign in again in Settings.';
  if (e instanceof Anthropic.APIConnectionError) return "Can't reach AirDial. Check your internet connection and try again.";
  if (e instanceof Anthropic.APIError) {
    const msg = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
    if (msg?.startsWith('AirDial') || msg?.startsWith("You've used")) return msg;
    if (e.status === 429) return 'AirDial Agent is busy right now. Please try again in a minute.';
    if ((e.status ?? 0) >= 500) return 'AirDial Agent is busy right now. Please try again in a minute.';
    return "AirDial Agent couldn't complete this step. Try again, or say it a different way.";
  }
  return "Something went wrong. Try again.";
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
