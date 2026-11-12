/**
 * PURPOSE
 * Creates sandbox test purchases so the buyer has something to dispute (PayPal Orders v2).
 * Money only moves in the PayPal SANDBOX (src/lib/env.ts refuses any other host).
 *
 * USAGE
 *   npm run seed:orders              create 2 orders and print the buyer approval URLs
 *   npm run seed:orders -- capture   capture every approved order (this is when sandbox money moves)
 *   npm run seed:orders -- status    show each order's status
 *
 * State (order ids, capture ids) is kept in logs/seed-orders.json (gitignored).
 * Docs: https://developer.paypal.com/docs/api/orders/v2/
 */
import "./load-env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { paypal, PayPalError } from "../src/lib/paypal";

const LOGS = resolve(import.meta.dirname, "..", "logs");
const STATE = resolve(LOGS, "seed-orders.json");

type Seed = { label: string; orderId: string; approveUrl?: string; status?: string; captureId?: string };

// Two demo purchases. The first matches the receipt fixture (Savanna Crafts, 48.50 USD) so the
// uploaded evidence lines up with the dispute in the demo.
const ITEMS = [
  { label: "dispute-1 (genuine INR claim)", description: "Handwoven sisal basket (Savanna Crafts)", value: "48.50" },
  { label: "dispute-2 (injection attempt)", description: "Beaded leather sandals (Savanna Crafts)", value: "35.00" },
];

const load = (): Seed[] => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : []);
const save = (s: Seed[]) => {
  mkdirSync(LOGS, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2));
};

type Order = { id: string; status: string; links: { rel: string; href: string }[]; purchase_units?: any[] };

async function create() {
  const seeds: Seed[] = [];
  for (const item of ITEMS) {
    const o = await paypal<Order>("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ description: item.description, amount: { currency_code: "USD", value: item.value } }],
    });
    const approve = o.links.find((l) => l.rel === "approve" || l.rel === "payer-action");
    seeds.push({ label: item.label, orderId: o.id, approveUrl: approve?.href, status: o.status });
  }
  save(seeds);
  console.log("ACTION FOR YOU: open each URL in a private window, log in as the SANDBOX PERSONAL (buyer) account, approve:\n");
  for (const s of seeds) console.log(`  ${s.label}\n  ${s.approveUrl}\n`);
  console.log("Then run: npm run seed:orders -- capture");
}

async function capture() {
  const seeds = load();
  for (const s of seeds) {
    if (s.captureId) {
      console.log(`SKIP  ${s.label}: already captured (${s.captureId})`);
      continue;
    }
    try {
      const o = await paypal<Order>("POST", `/v2/checkout/orders/${s.orderId}/capture`, {});
      const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
      s.captureId = cap?.id;
      s.status = o.status;
      console.log(`PASS  ${s.label}: order ${o.status}, capture ${cap?.id} ${cap?.status}`);
    } catch (e) {
      // 422 ORDER_NOT_APPROVED = the buyer has not approved this one yet.
      console.log(`FAIL  ${s.label}: ${e instanceof PayPalError ? `HTTP ${e.status} ${e.body.slice(0, 200)}` : e}`);
    }
  }
  save(seeds);
}

async function status() {
  for (const s of load()) {
    const o = await paypal<Order>("GET", `/v2/checkout/orders/${s.orderId}`);
    console.log(`${s.label}: ${o.status}${s.captureId ? ` (capture ${s.captureId})` : ""}`);
  }
}

const cmd = process.argv[2] ?? "create";
await ({ create, capture, status } as Record<string, () => Promise<void>>)[cmd]!();
