// Loads .env from the repo root and validates it. Each gate asks only for the vars it needs.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "../../../..");
const envPath = resolve(ROOT, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const SANDBOX_HOST = "api-m.sandbox.paypal.com";

const schemas = {
  meta: z.object({
    MODEL_API_KEY: z.string({ error: "fill in MODEL_API_KEY= in .env" }).min(1, "fill in MODEL_API_KEY= in .env"),
    META_BASE_URL: z.string().url(),
    META_MODEL: z.string().default(""),
  }),
  paypal: z.object({
    PAYPAL_CLIENT_ID: z.string({ error: "fill in PAYPAL_CLIENT_ID= in .env" }).min(1, "fill in PAYPAL_CLIENT_ID= in .env"),
    PAYPAL_CLIENT_SECRET: z.string({ error: "fill in PAYPAL_CLIENT_SECRET= in .env" }).min(1, "fill in PAYPAL_CLIENT_SECRET= in .env"),
    PAYPAL_BASE_URL: z.string().url(),
  }),
  webhook: z.object({
    PAYPAL_WEBHOOK_ID: z.string().default(""),
  }),
};

type Schemas = typeof schemas;

export function loadEnv<K extends keyof Schemas>(group: K): z.infer<Schemas[K]> {
  // Treat blank values as missing so defaults and "fill in" messages apply.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = schemas[group].safeParse(raw);
  if (!parsed.success) {
    console.error(`BLOCKED: .env is incomplete (${envPath})`);
    for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    process.exit(2);
  }
  if (group === "paypal") {
    const host = new URL((parsed.data as z.infer<Schemas["paypal"]>).PAYPAL_BASE_URL).host;
    if (host !== SANDBOX_HOST) {
      console.error(`ABORT: PAYPAL_BASE_URL host is "${host}", expected "${SANDBOX_HOST}". Sandbox only.`);
      process.exit(3);
    }
  }
  return parsed.data as z.infer<Schemas[K]>;
}

export const PATHS = {
  root: ROOT,
  spike: resolve(ROOT, "spikes/gate-check"),
  fixtures: resolve(ROOT, "spikes/gate-check/fixtures"),
  logs: resolve(ROOT, "spikes/gate-check/logs"),
};
