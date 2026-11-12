/**
 * PURPOSE
 * Server-side settings for the DisputeGuard app, validated with zod. Moved from the gate-check
 * spike (spikes/gate-check/src/lib/env.ts) and adapted for Next.js:
 * - Next.js loads `.env` itself, so we only read process.env. Standalone scripts (seed, eval)
 *   load it through `scripts/load-env.ts` first.
 * - Instead of `process.exit` (which would kill the web server), a missing value THROWS an error
 *   that says exactly which `.env` line to fill in.
 * - Each group is validated lazily, the first time it is needed, so the dashboard can still render
 *   (and show a clear error) when, say, the webhook id is not set yet.
 *
 * SAFETY
 * `env("paypal")` refuses anything but the PayPal SANDBOX host. This app never talks to live PayPal.
 * Values are never logged.
 */
import { z } from "zod";

/** The only PayPal host this app is allowed to call. */
export const SANDBOX_HOST = "api-m.sandbox.paypal.com";

const required = (name: string) =>
  z.string({ error: `fill in ${name}= in .env` }).min(1, `fill in ${name}= in .env`);

const schemas = {
  meta: z.object({
    MODEL_API_KEY: required("MODEL_API_KEY"),
    META_BASE_URL: z.string().url().default("https://api.meta.ai/v1"),
    META_MODEL: z.string().default("muse-spark-1.3"),
  }),
  paypal: z.object({
    PAYPAL_CLIENT_ID: required("PAYPAL_CLIENT_ID"),
    PAYPAL_CLIENT_SECRET: required("PAYPAL_CLIENT_SECRET"),
    PAYPAL_BASE_URL: z.string().url().default(`https://${SANDBOX_HOST}`),
  }),
  webhook: z.object({
    PAYPAL_WEBHOOK_ID: required("PAYPAL_WEBHOOK_ID"),
  }),
};

type Schemas = typeof schemas;
const cache = new Map<keyof Schemas, unknown>();

/** Returns the validated settings for one group, or throws a readable "fill in X=" error. */
export function env<K extends keyof Schemas>(group: K): z.infer<Schemas[K]> {
  if (cache.has(group)) return cache.get(group) as z.infer<Schemas[K]>;

  // Treat blank values as missing so defaults and "fill in" messages apply.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = schemas[group].safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration incomplete (${group}): ${msg}`);
  }

  if (group === "paypal") {
    const host = new URL((parsed.data as z.infer<Schemas["paypal"]>).PAYPAL_BASE_URL).host;
    if (host !== SANDBOX_HOST) {
      throw new Error(`ABORT: PAYPAL_BASE_URL host is "${host}", expected "${SANDBOX_HOST}". Sandbox only.`);
    }
  }

  cache.set(group, parsed.data);
  return parsed.data as z.infer<Schemas[K]>;
}
