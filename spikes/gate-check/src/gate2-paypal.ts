/**
 * PURPOSE
 * Gate 2 of the gate-check spike: prove we can use the PayPal SANDBOX "money side" that
 * DisputeGuard depends on: auth, the Disputes API, and a real test payment to dispute.
 *
 * WHY SUBCOMMANDS
 * Some steps need a human in the middle (approving a payment as the sandbox buyer, filing a
 * dispute in the Resolution Center). So instead of one long script, each step is a subcommand,
 * and ids are saved to logs/state.json so the next step can pick them up:
 *
 *   npm run gate2 -- token          2a  get an OAuth2 token (aborts if not sandbox)
 *   npm run gate2 -- list           2b  list disputes (empty list = PASS for access)
 *   npm run gate2 -- order          2c  create a $12.34 order, print the buyer approval URL
 *   npm run gate2 -- capture        2c  after the buyer approved: capture the money, save ids
 *   npm run gate2 -- watch-dispute  2d  re-list every 20s until the buyer's dispute shows up
 *   npm run gate2 -- details [id]   2e  full dispute JSON -> fixtures/dispute-sample.json
 *   npm run gate2 -- message [id]   2f  send a message to the buyer (non-destructive write)
 *
 * WHAT IS DELIBERATELY NOT HERE
 * accept-claim, make-offer, escalate, provide-evidence: they move money or change the dispute's
 * outcome, so they are only added after the owner explicitly says yes (CLAUDE.md rule).
 *
 * DOCS USED (read 2026-11-10)
 * - Disputes: https://developer.paypal.com/docs/api/customer-disputes/v1/
 * - Disputes guide + sandbox notes: https://developer.paypal.com/platforms/disputes/integrate-disputes
 * - Orders v2: https://developer.paypal.com/docs/api/orders/v2/
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PATHS } from "./lib/env.js";
import { getToken, paypal, PayPalError } from "./lib/paypal.js";

// ---------- small helpers: state file + PASS/FAIL/BLOCKED printing ----------

type State = {
  orderId?: string;
  approveUrl?: string;
  captureId?: string; // the seller-side transaction id; disputes reference it
  capturedAt?: string;
  disputeId?: string;
  results?: Record<string, { status: string; detail: string; at: string }>;
};
const STATE_FILE = resolve(PATHS.logs, "state.json");

function loadState(): State {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
}
function saveState(s: State) {
  mkdirSync(PATHS.logs, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/** Prints one result line and remembers it in state.json, so GATES.md can be written from it. */
function report(check: string, status: "PASS" | "FAIL" | "BLOCKED", detail: string) {
  console.log(`${status.padEnd(7)} ${check}  ${detail}`);
  const s = loadState();
  s.results = { ...s.results, [check]: { status, detail, at: new Date().toISOString() } };
  saveState(s);
}

/** Turns an HTTP error into a human diagnosis (the most likely cause for each status). */
function diagnose(err: unknown): string {
  if (!(err instanceof PayPalError)) return err instanceof Error ? err.message : String(err);
  const hint: Record<number, string> = {
    401: "likely cause: wrong client id/secret, or live credentials used against the sandbox",
    403: "likely cause: the REST app does not have the Disputes feature enabled (Apps & Credentials > app > Features), or the token lacks the disputes scope",
    404: "likely cause: wrong id, or the resource belongs to a different sandbox account",
    422: "likely cause: the action is not allowed at the dispute's current stage/status",
  };
  return `${err.message}\n        ${hint[err.status] ?? ""}`;
}

// ---------- the steps ----------

/** 2a. Token. loadEnv (inside lib/paypal) has already aborted if the host is not the sandbox. */
async function token() {
  try {
    const { scope } = await getToken();
    // Print only whether the disputes scopes are present, never the token itself.
    const disputeScopes = scope.split(" ").filter((s) => s.includes("disputes"));
    report("2a", "PASS", `token ok; dispute scopes: ${disputeScopes.join(", ") || "NONE (expect 2b to fail)"}`);
  } catch (err) {
    report("2a", "FAIL", diagnose(err));
  }
}

/** 2b. List disputes. Access is what we're testing, so an empty list is still a PASS. */
async function list() {
  try {
    const res = await paypal<{ items?: any[] }>("GET", "/v1/customer/disputes?page_size=10");
    const items = res.items ?? [];
    report("2b", "PASS", `${items.length} dispute(s) visible`);
    for (const d of items) {
      console.log(`        ${d.dispute_id}  ${d.status}  ${d.dispute_life_cycle_stage}  ${d.reason}  ${d.dispute_amount?.value} ${d.dispute_amount?.currency_code}`);
    }
  } catch (err) {
    report("2b", "FAIL", diagnose(err));
  }
}

/** 2c (part 1). Create a small order and print the URL the buyer must open to approve it. */
async function order() {
  try {
    const res = await paypal<{ id: string; status: string; links: { rel: string; href: string }[] }>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [{ description: "DisputeGuard gate-check test", amount: { currency_code: "USD", value: "12.34" } }],
      },
    );
    // Docs: the buyer approves at the HATEOAS link with rel "approve" ("payer-action" in some flows).
    const approve = res.links.find((l) => l.rel === "approve" || l.rel === "payer-action");
    saveState({ ...loadState(), orderId: res.id, approveUrl: approve?.href });
    report("2c", "BLOCKED", `order ${res.id} created (status ${res.status}); waiting for buyer approval`);
    console.log(`\n  ACTION FOR YOU: open this URL, log in as the SANDBOX PERSONAL (buyer) account, click Pay/Continue:\n  ${approve?.href}\n  Then run: npm run gate2 -- capture\n`);
  } catch (err) {
    report("2c", "FAIL", diagnose(err));
  }
}

/** 2c (part 2). Capture the approved order: this is the moment money moves (sandbox money). */
async function capture() {
  const s = loadState();
  if (!s.orderId) return report("2c", "FAIL", "no orderId in logs/state.json; run `order` first");
  try {
    const res = await paypal<any>("POST", `/v2/checkout/orders/${s.orderId}/capture`, {});
    const cap = res.purchase_units?.[0]?.payments?.captures?.[0];
    saveState({ ...loadState(), captureId: cap?.id, capturedAt: new Date().toISOString() });
    writeFileSync(resolve(PATHS.logs, "capture-response.json"), JSON.stringify(res, null, 2));
    report("2c", cap?.id ? "PASS" : "FAIL", `order ${res.status}; capture id ${cap?.id ?? "NOT FOUND (see logs/capture-response.json)"} ${cap?.status ?? ""}`);
  } catch (err) {
    // 422 ORDER_NOT_APPROVED is the usual reason: the buyer has not approved yet.
    report("2c", "FAIL", diagnose(err));
  }
}

/**
 * 2d. Dispute creation. The docs only offer a sandbox create-dispute API behind the
 * DISPUTE_CREATE scope, which needs a PayPal account manager to enable. So the buyer files it by
 * hand, and this step polls the list (every 20s, up to 15 minutes) until a new dispute appears.
 */
async function watchDispute() {
  const s = loadState();
  console.log(DISPUTE_INSTRUCTIONS(s.captureId));
  const since = s.capturedAt ?? new Date(Date.now() - 86_400_000).toISOString();
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await paypal<{ items?: any[] }>("GET", `/v1/customer/disputes?create_time_after=${encodeURIComponent(since)}&page_size=10`);
      const found = res.items?.[0];
      if (found) {
        saveState({ ...loadState(), disputeId: found.dispute_id });
        return report("2d", "PASS", `dispute ${found.dispute_id} appeared (${found.status}, ${found.dispute_life_cycle_stage}, ${found.reason})`);
      }
      console.log(`        ${new Date().toLocaleTimeString()} no dispute yet...`);
    } catch (err) {
      return report("2d", "FAIL", diagnose(err));
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  report("2d", "BLOCKED", "no dispute appeared within 15 minutes; file it by hand, then re-run watch-dispute");
}

const DISPUTE_INSTRUCTIONS = (captureId?: string) => `
  ACTION FOR YOU: open a dispute as the sandbox buyer
  1. Go to https://www.sandbox.paypal.com and log in with the SANDBOX PERSONAL (buyer) account
     (Developer Dashboard > Testing Tools > Sandbox Accounts shows its email and password).
  2. Open Activity, click the $12.34 payment to the merchant${captureId ? ` (seller transaction ${captureId})` : ""}.
  3. Click "Report a problem" (or open https://www.sandbox.paypal.com/resolutioncenter and "Report a problem").
  4. Choose "I didn't receive an item I paid for" (reason MERCHANDISE_OR_SERVICE_NOT_RECEIVED) and submit.
  I'm polling the Disputes API every 20s and will report when it appears.
`;

/** 2e. Full dispute details. Saved as a fixture for building the real agent later. */
async function details(id?: string) {
  const disputeId = id ?? loadState().disputeId;
  if (!disputeId) return report("2e", "FAIL", "no dispute id; pass one or run watch-dispute first");
  try {
    const d = await paypal<any>("GET", `/v1/customer/disputes/${disputeId}`);
    writeFileSync(resolve(PATHS.fixtures, "dispute-sample.json"), JSON.stringify(redact(d), null, 2));
    // The links array is how PayPal tells us which actions are allowed right now (HATEOAS).
    const actions = (d.links ?? []).map((l: any) => `${l.rel}(${l.method})`).join(", ");
    report("2e", "PASS", `saved fixtures/dispute-sample.json`);
    console.log(`        status=${d.status} stage=${d.dispute_life_cycle_stage} channel=${d.dispute_channel} reason=${d.reason}`);
    console.log(`        seller_response_due_date=${d.seller_response_due_date ?? "-"} buyer_response_due_date=${d.buyer_response_due_date ?? "-"}`);
    console.log(`        allowed actions (links): ${actions || "-"}`);
    console.log(`        allowed_response_options: ${JSON.stringify(d.allowed_response_options ?? {})}`);
  } catch (err) {
    report("2e", "FAIL", diagnose(err));
  }
}

/**
 * The fixture is committed to a PUBLIC repo. Sandbox data is fake, but we still mask emails and
 * names so the habit is right from day one.
 */
function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        /email/i.test(k) ? [k, "redacted@example.com"] : k === "name" && typeof v === "string" ? [k, "REDACTED"] : [k, redact(v)],
      ),
    );
  }
  return value;
}

/** 2f. Send a message to the buyer: a write that neither moves money nor closes the dispute. */
async function message(id?: string) {
  const disputeId = id ?? loadState().disputeId;
  if (!disputeId) return report("2f", "FAIL", "no dispute id; pass one or run watch-dispute first");
  try {
    await paypal("POST", `/v1/customer/disputes/${disputeId}/send-message`, {
      message: "Hi, this is the seller. We shipped your order with tracking. Could you check with your neighbours? (DisputeGuard sandbox test)",
    });
    report("2f", "PASS", `send-message accepted for ${disputeId}`);
  } catch (err) {
    report("2f", "FAIL", diagnose(err));
  }
}

// ---------- entry point ----------

const steps: Record<string, (arg?: string) => Promise<void>> = {
  token,
  list,
  order,
  capture,
  "watch-dispute": watchDispute,
  details,
  message,
};
const [cmd, arg] = process.argv.slice(2);
const step = cmd ? steps[cmd] : undefined;
if (!step) {
  console.log(`usage: npm run gate2 -- <${Object.keys(steps).join(" | ")}> [disputeId]`);
  process.exit(1);
}
await step(arg);
