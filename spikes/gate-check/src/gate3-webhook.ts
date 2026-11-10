/**
 * PURPOSE
 * Gate 3 of the gate-check spike: prove the agent can HEAR about disputes. PayPal sends an HTTP
 * POST (a "webhook") to our public URL whenever a dispute is created or updated. This file is a
 * small Fastify server that receives those POSTs.
 *
 * WHAT HAPPENS TO EACH INCOMING EVENT
 *   3a. Read the RAW request body (as a string, not parsed JSON) and append it to
 *       logs/events.jsonl, then reply 200 straight away. PayPal retries (up to 25 times over
 *       3 days) if we're slow or return non-2xx, so the reply must not wait on anything.
 *   3c. De-duplicate by event id. Because PayPal retries, the same event can arrive twice;
 *       processing it twice (e.g. drafting two responses) would be a bug. Processed ids are kept
 *       in memory and in logs/processed-ids.txt so they survive a restart.
 *   3b. Verify the signature by asking PayPal: POST /v1/notifications/verify-webhook-signature
 *       with the PAYPAL-* headers we received, our PAYPAL_WEBHOOK_ID, and the event EXACTLY as it
 *       arrived (docs warn that parsing and re-serializing the JSON can make verification fail).
 *       Answer "SUCCESS" means the event really came from PayPal.
 *
 * RUN
 *   npm run gate3                  starts the server on http://localhost:8787
 *   cloudflared tunnel --url http://localhost:8787   gives a public https URL (3d)
 *   Register <public URL>/webhooks/paypal in the PayPal dashboard. PAYPAL_WEBHOOK_ID is re-read
 *   from .env on every event, so it can be filled in without restarting the server.
 *
 * NOTE: events from the dashboard's Webhook SIMULATOR are mock events and cannot be verified by
 * PayPal's postback API (per the docs), so they will show "verification: FAILURE". Only a real
 * dispute event can fully pass 3e.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import Fastify from "fastify";
import { PATHS } from "./lib/env.js";
import { paypal, PayPalError } from "./lib/paypal.js";

const PORT = Number(process.env.PORT ?? 8787);
const EVENTS_FILE = resolve(PATHS.logs, "events.jsonl");
const PROCESSED_FILE = resolve(PATHS.logs, "processed-ids.txt");
const RESULTS_FILE = resolve(PATHS.logs, "gate3-results.jsonl");
mkdirSync(PATHS.logs, { recursive: true });

// 3c. Load the ids we already processed (one per line) so a restart doesn't forget them.
const processed = new Set(existsSync(PROCESSED_FILE) ? readFileSync(PROCESSED_FILE, "utf8").split("\n").filter(Boolean) : []);

/** Reads PAYPAL_WEBHOOK_ID fresh from .env, so it can be added while the server runs. */
function webhookId(): string {
  const file = resolve(PATHS.root, ".env");
  const vars = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return (vars.PAYPAL_WEBHOOK_ID ?? process.env.PAYPAL_WEBHOOK_ID ?? "").trim();
}

/** Records a check result both on screen and in logs/gate3-results.jsonl (used for GATES.md). */
function report(check: string, status: "PASS" | "FAIL" | "SKIP", detail: string) {
  console.log(`${status.padEnd(5)} ${check}  ${detail}`);
  appendFileSync(RESULTS_FILE, JSON.stringify({ check, status, detail, at: new Date().toISOString() }) + "\n");
}

const app = Fastify({ logger: false });

// Keep JSON bodies as the raw string. Fastify would normally parse them into an object, which
// would lose the exact bytes that signature verification needs.
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

// A quick way to check the tunnel works: open <public URL>/health in a browser.
app.get("/health", async () => ({ ok: true }));

app.post("/webhooks/paypal", async (req, reply) => {
  const raw = String(req.body ?? "");
  const h = req.headers;

  // 3a. Log first (append-only), then answer 200 immediately.
  appendFileSync(
    EVENTS_FILE,
    JSON.stringify({
      receivedAt: new Date().toISOString(),
      transmissionId: h["paypal-transmission-id"],
      raw,
    }) + "\n",
  );
  reply.code(200).send({ received: true });

  // Everything below runs after the reply, so PayPal never waits on it.
  setImmediate(() => void handleEvent(raw, h as Record<string, string | undefined>));
});

async function handleEvent(raw: string, h: Record<string, string | undefined>) {
  let event: { id?: string; event_type?: string; resource?: { dispute_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return report("3a", "FAIL", `body is not JSON (${raw.slice(0, 80)})`);
  }
  report("3a", "PASS", `received ${event.event_type} id=${event.id} dispute=${event.resource?.dispute_id ?? "-"}`);

  // 3c. Skip anything we've already handled.
  if (!event.id) return report("3c", "FAIL", "event has no id, cannot de-duplicate");
  if (processed.has(event.id)) return report("3c", "PASS", `duplicate ${event.id} ignored`);
  processed.add(event.id);
  appendFileSync(PROCESSED_FILE, event.id + "\n");

  // 3b. Ask PayPal whether the signature is genuine.
  const id = webhookId();
  if (!id) return report("3b", "SKIP", "PAYPAL_WEBHOOK_ID is empty in .env; cannot verify yet");
  // Build the request body by hand so webhook_event is the raw string, byte-for-byte.
  const body =
    `{"auth_algo":${JSON.stringify(h["paypal-auth-algo"] ?? "")},` +
    `"cert_url":${JSON.stringify(h["paypal-cert-url"] ?? "")},` +
    `"transmission_id":${JSON.stringify(h["paypal-transmission-id"] ?? "")},` +
    `"transmission_sig":${JSON.stringify(h["paypal-transmission-sig"] ?? "")},` +
    `"transmission_time":${JSON.stringify(h["paypal-transmission-time"] ?? "")},` +
    `"webhook_id":${JSON.stringify(id)},` +
    `"webhook_event":${raw}}`;
  try {
    const res = await paypal<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", body);
    const ok = res.verification_status === "SUCCESS";
    report("3b", ok ? "PASS" : "FAIL", `verification_status=${res.verification_status} for ${event.event_type} ${event.id}`);
    if (ok && event.event_type?.startsWith("CUSTOMER.DISPUTE.")) {
      report("3e", "PASS", `real dispute event ${event.event_type} arrived and verified`);
    }
  } catch (err) {
    report("3b", "FAIL", err instanceof PayPalError ? err.message : String(err));
  }
}

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`gate3 listening on http://localhost:${PORT}  (POST /webhooks/paypal, GET /health)`);
console.log(`PAYPAL_WEBHOOK_ID: ${webhookId() ? "set" : "EMPTY (events will be logged but not verified)"}`);
