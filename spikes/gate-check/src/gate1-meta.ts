// Gate 1: Meta Model API (chat completions, OpenAI-compatible).
// Docs: https://dev.meta.ai/docs/protocols/chat-completions, /tool-calling, /structured-output,
// /file-handling, /pricing-rate-limits.
// Usage: npm run gate1            (all checks)
//        npm run gate1 -- 1c 1d   (only these checks, to save credits)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { loadEnv, PATHS } from "./lib/env.js";

const env = loadEnv("meta");
const only = process.argv.slice(2);
const MAX_TOKENS = 1024; // reasoning tokens count as output, so leave headroom
const REASONING = "minimal";

// USD per 1M tokens, from https://dev.meta.ai/docs/pricing-rate-limits (read 2026-10-28).
const PRICING: Record<string, { input: number; cached: number; output: number }> = {
  "muse-wonder-1.0": { input: 4.0, cached: 0.2, output: 20.0 },
  "muse-spark-1.3": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.1": { input: 1.25, cached: 0.15, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, cached: 0.002, output: 0.2 },
  "muse-spark-1.2-contributor": { input: 0.1, cached: 0.002, output: 0.2 },
};

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};
type Message = {
  role: string;
  content: unknown;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};
type CallLog = { check: string; ms: number; usage: Usage; costUsd: number | null };
type Result = { check: string; status: "PASS" | "FAIL" | "SKIP"; detail: string };

const calls: CallLog[] = [];
const results: Result[] = [];

class HttpError extends Error {}

async function metaFetch(path: string, init: RequestInit = {}): Promise<{ json: any; ms: number }> {
  const started = performance.now();
  const res = await fetch(`${env.META_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  const ms = Math.round(performance.now() - started);
  const text = await res.text();
  if (!res.ok) throw new HttpError(`HTTP ${res.status} ${res.statusText} on ${path}: ${text.slice(0, 800)}`);
  return { json: JSON.parse(text), ms };
}

function cost(model: string, u: Usage): number | null {
  const p = PRICING[model];
  if (!p) return null;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = (u.prompt_tokens ?? 0) - cached;
  return (fresh * p.input + cached * p.cached + (u.completion_tokens ?? 0) * p.output) / 1e6;
}

async function chat(check: string, model: string, body: Record<string, unknown>) {
  const { json, ms } = await metaFetch("/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model, reasoning_effort: REASONING, max_completion_tokens: MAX_TOKENS, ...body }),
  });
  const usage: Usage = json.usage ?? {};
  calls.push({ check, ms, usage, costUsd: cost(model, usage) });
  const choice = json.choices?.[0];
  return { message: choice?.message as Message, finish: choice?.finish_reason as string, raw: json };
}

async function run(check: string, title: string, fn: () => Promise<string>) {
  if (only.length && !only.includes(check)) return;
  try {
    const detail = await fn();
    results.push({ check, status: "PASS", detail });
    console.log(`PASS  ${check} ${title}\n      ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ check, status: "FAIL", detail });
    console.log(`FAIL  ${check} ${title}\n      ${detail}`);
  }
}

// --- 0. pick the model id from the live list, not from memory ---
async function pickModel(): Promise<string> {
  try {
    const { json } = await metaFetch("/models");
    const ids: string[] = (json.data ?? []).map((m: { id: string }) => m.id);
    console.log(`models: ${ids.join(", ")}`);
    if (env.META_MODEL) {
      if (!ids.includes(env.META_MODEL)) console.log(`WARN  META_MODEL=${env.META_MODEL} is not in the list`);
      return env.META_MODEL;
    }
    const preferred = ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"].find((id) => ids.includes(id));
    if (!preferred) throw new Error("no muse-spark model in the list; set META_MODEL in .env");
    console.log(`using ${preferred} (set META_MODEL= in .env to pin it)`);
    return preferred;
  } catch (err) {
    console.log(`FAIL  0  GET /models\n      ${err instanceof Error ? err.message : err}`);
    if (!env.META_MODEL) process.exit(1);
    return env.META_MODEL;
  }
}

const model = await pickModel();
console.log(`model: ${model}, reasoning_effort: ${REASONING}\n`);

await run("1a", "plain chat completion", async () => {
  const { message, finish } = await chat("1a", model, {
    messages: [{ role: "user", content: "Reply with exactly the word: pong" }],
  });
  const text = String(message?.content ?? "").trim();
  if (!text) throw new Error(`empty content (finish_reason=${finish})`);
  return `reply="${text.slice(0, 80)}" finish=${finish}`;
});

await run("1b", "tool calling round trip", async () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "get_dispute_deadline",
        description: "Returns the date by which the seller must respond to a PayPal dispute.",
        parameters: {
          type: "object",
          properties: { dispute_id: { type: "string", description: "PayPal dispute id, e.g. PP-D-12345" } },
          required: ["dispute_id"],
          additionalProperties: false,
        },
      },
    },
  ];
  const messages: Message[] = [
    { role: "user", content: "When is the seller response deadline for dispute PP-D-12345? Use the tool." },
  ];
  const first = await chat("1b-call", model, { messages, tools, tool_choice: "auto", parallel_tool_calls: false });
  const call = first.message?.tool_calls?.[0];
  if (!call) throw new Error(`no tool call (finish=${first.finish}, content="${String(first.message?.content).slice(0, 120)}")`);
  const args = z.object({ dispute_id: z.string() }).parse(JSON.parse(call.function.arguments));
  // Fake tool.
  const toolResult = { dispute_id: args.dispute_id, seller_response_due_date: "2026-11-07T23:59:59Z" };
  messages.push(first.message, { role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
  const final = await chat("1b-final", model, { messages, tools, tool_choice: "auto" });
  const text = String(final.message?.content ?? "");
  if (!/2026-11-07|November 7|Nov(ember)?\.? 7/i.test(text)) throw new Error(`final answer lacks the deadline: "${text.slice(0, 200)}"`);
  return `tool=${call.function.name} args=${call.function.arguments} final="${text.slice(0, 120).replace(/\s+/g, " ")}"`;
});

const Decision = z.object({
  decision: z.enum(["fight", "settle"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).min(1),
});

await run("1c", "structured output (zod-validated)", async () => {
  const dispute =
    "Buyer claims ITEM_NOT_RECEIVED for a $48.50 basket. Seller has DHL tracking showing delivery on " +
    "2026-10-24 with a signature, to the buyer's PayPal-confirmed address.";
  const { message } = await chat("1c", model, {
    messages: [
      { role: "developer", content: "You advise a merchant whether to fight or settle a PayPal dispute." },
      { role: "user", content: dispute },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "DisputeDecision",
        strict: true,
        schema: {
          type: "object",
          properties: {
            decision: { type: "string", enum: ["fight", "settle"] },
            confidence: { type: "number", description: "0 to 1" },
            reasons: { type: "array", items: { type: "string" } },
          },
          required: ["decision", "confidence", "reasons"],
          additionalProperties: false,
        },
      },
    },
  });
  const parsed = Decision.parse(JSON.parse(String(message?.content)));
  return JSON.stringify(parsed).slice(0, 200);
});

const Receipt = z.object({ merchant: z.string(), amount: z.string(), date: z.string() });
const receiptFormat = {
  type: "json_schema",
  json_schema: {
    name: "Receipt",
    strict: true,
    schema: {
      type: "object",
      properties: {
        merchant: { type: "string" },
        amount: { type: "string", description: "total with currency" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["merchant", "amount", "date"],
      additionalProperties: false,
    },
  },
};

await run("1d", "image input (fixtures/receipt.png)", async () => {
  const b64 = readFileSync(resolve(PATHS.fixtures, "receipt.png")).toString("base64");
  const { message } = await chat("1d", model, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the merchant, total amount and date from this receipt." },
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      },
    ],
    response_format: receiptFormat,
  });
  const r = Receipt.parse(JSON.parse(String(message?.content)));
  const ok = /savanna/i.test(r.merchant) && r.amount.includes("48.50") && r.date.includes("2026-10-20");
  if (!ok) throw new Error(`wrong extraction: ${JSON.stringify(r)}`);
  return JSON.stringify(r);
});

await run("1e", "PDF input (fixtures/evidence.pdf, inline file part)", async () => {
  const b64 = readFileSync(resolve(PATHS.fixtures, "evidence.pdf")).toString("base64");
  const { message } = await chat("1e", model, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "From this shipping evidence, give the carrier tracking number and delivery date only." },
          { type: "file", file: { filename: "evidence.pdf", file_data: `data:application/pdf;base64,${b64}` } },
        ],
      },
    ],
  });
  const text = String(message?.content ?? "");
  if (!text.includes("1Z999AA10123456784")) throw new Error(`tracking number not found in reply: "${text.slice(0, 200)}"`);
  return `reply="${text.slice(0, 160).replace(/\s+/g, " ")}"`;
}).then(() => {
  const r = results.find((x) => x.check === "1e");
  if (r?.status === "FAIL") console.log("      (informational) fallback: render pages to images");
});

// --- 1f. latency, tokens, cost ---
console.log("\n1f  per-call latency / tokens / cost");
console.log("check      ms     in   cached   out  (reasoning)  cost USD");
let totIn = 0, totOut = 0, totCost = 0;
for (const c of calls) {
  const u = c.usage;
  totIn += u.prompt_tokens ?? 0;
  totOut += u.completion_tokens ?? 0;
  totCost += c.costUsd ?? 0;
  console.log(
    `${c.check.padEnd(9)} ${String(c.ms).padStart(5)} ${String(u.prompt_tokens ?? "?").padStart(6)} ` +
      `${String(u.prompt_tokens_details?.cached_tokens ?? 0).padStart(7)} ${String(u.completion_tokens ?? "?").padStart(5)} ` +
      `${String(u.completion_tokens_details?.reasoning_tokens ?? "-").padStart(12)}  ${c.costUsd?.toFixed(6) ?? "n/a"}`,
  );
}
console.log(`TOTAL     calls=${calls.length} in=${totIn} out=${totOut} cost≈$${totCost.toFixed(6)}`);
results.push({ check: "1f", status: calls.every((c) => c.usage.total_tokens !== undefined) ? "PASS" : "FAIL", detail: `${calls.length} calls, usage recorded` });

mkdirSync(PATHS.logs, { recursive: true });
const out = resolve(PATHS.logs, `gate1-${Date.now()}.json`);
writeFileSync(out, JSON.stringify({ model, reasoning: REASONING, results, calls }, null, 2));
console.log(`\nsaved ${out}`);
