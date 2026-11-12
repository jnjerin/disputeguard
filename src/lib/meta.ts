/**
 * PURPOSE
 * Client for Meta's Model API (Muse Spark), moved from the gate-check spike where every feature
 * we use was proven: chat, tool calling, strict JSON-schema output, inline images and PDFs.
 *
 * HOW IT TALKS TO META
 * The API is OpenAI-compatible: POST {META_BASE_URL}/chat/completions with a Bearer key. We use
 * plain fetch (no SDK). Findings from the spike that shape this file:
 * - Only `tool_choice: "auto"` is supported, so callers must cope with a text answer instead of
 *   a tool call.
 * - `response_format: json_schema` with `strict: true` is enforced server-side; callers still
 *   validate with zod.
 * - Reasoning tokens are billed as output, so `max_completion_tokens` leaves headroom.
 *
 * Every call returns its latency, token usage and estimated cost so agent runs can be audited.
 */
import { env } from "./env";

// USD per 1M tokens, from https://dev.meta.ai/docs/pricing-rate-limits (read 2026-10-28).
const PRICING: Record<string, { input: number; cached: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-wonder-1.0": { input: 4.0, cached: 0.2, output: 20.0 },
};

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system" | "developer" | "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type ChatResult = {
  message: Extract<ChatMessage, { role: "assistant" }>;
  finishReason: string;
  usage: Usage;
  ms: number;
  costUsd: number;
  model: string;
};

/** Estimated USD cost: fresh input + cached input + output (reasoning counts as output). */
export function estimateCost(model: string, u: Usage): number {
  const p = PRICING[model] ?? PRICING["muse-spark-1.3"]!;
  const cachedIn = u.prompt_tokens_details?.cached_tokens ?? 0;
  const freshIn = (u.prompt_tokens ?? 0) - cachedIn;
  return (freshIn * p.input + cachedIn * p.cached + (u.completion_tokens ?? 0) * p.output) / 1_000_000;
}

/**
 * One chat completion. Throws with the real HTTP status and error body on failure
 * (fail loudly; no silent retries).
 */
export async function chat(body: {
  messages: ChatMessage[];
  tools?: unknown[];
  response_format?: unknown;
  max_completion_tokens?: number;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
}): Promise<ChatResult> {
  const e = env("meta");
  const started = performance.now();
  const res = await fetch(`${e.META_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.MODEL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: e.META_MODEL,
      messages: body.messages,
      reasoning_effort: body.reasoning_effort ?? "low",
      max_completion_tokens: body.max_completion_tokens ?? 2048,
      ...(body.tools ? { tools: body.tools, tool_choice: "auto" } : {}),
      ...(body.response_format ? { response_format: body.response_format } : {}),
    }),
    cache: "no-store",
  });
  const ms = Math.round(performance.now() - started);
  const text = await res.text();
  if (!res.ok) throw new Error(`Meta API HTTP ${res.status}: ${text.slice(0, 600)}`);
  const json = JSON.parse(text);
  const choice = json.choices?.[0];
  if (!choice) throw new Error(`Meta API returned no choices: ${text.slice(0, 300)}`);
  const usage: Usage = json.usage ?? {};
  return {
    message: choice.message,
    finishReason: choice.finish_reason,
    usage,
    ms,
    costUsd: estimateCost(e.META_MODEL, usage),
    model: e.META_MODEL,
  };
}
