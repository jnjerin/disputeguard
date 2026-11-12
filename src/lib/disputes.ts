/**
 * PURPOSE
 * Reading disputes from PayPal and keeping our database in step with them (READ-ONLY toward
 * PayPal). Used by the webhook route (automatic path) and the "Sync from PayPal" button (manual
 * path).
 *
 * Disputes API v1 docs: https://developer.paypal.com/docs/api/customer-disputes/v1/
 * - GET /v1/customer/disputes            list (summary items with dispute_id)
 * - GET /v1/customer/disputes/{id}       full details: status, reason, amount, stage, deadlines,
 *                                        messages, disputed_transactions, HATEOAS `links`
 */
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { paypal } from "./paypal";

/** The subset of the PayPal dispute body we read. The full body is stored as `raw`. */
export type PayPalDispute = {
  dispute_id: string;
  create_time?: string;
  update_time?: string;
  reason: string;
  status: string;
  dispute_life_cycle_stage?: string;
  dispute_channel?: string;
  dispute_amount?: { currency_code: string; value: string };
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  dispute_outcome?: { outcome_code?: string };
  disputed_transactions?: {
    seller_transaction_id?: string;
    buyer_transaction_id?: string;
    buyer?: { name?: string };
    items?: { item_description?: string; item_name?: string }[];
  }[];
  messages?: { posted_by: string; time_posted: string; content: string }[];
  offer?: unknown;
  links?: { href: string; rel: string; method: string }[];
  allowed_response_options?: Record<string, unknown>;
};

const date = (s?: string) => (s ? new Date(s) : null);

/** Fetches one dispute's full details from PayPal and upserts it into the database. */
export async function upsertDisputeFromPayPal(disputeId: string) {
  const d = await paypal<PayPalDispute>("GET", `/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
  const tx = d.disputed_transactions?.[0];
  const data = {
    status: d.status,
    stage: d.dispute_life_cycle_stage ?? null,
    reason: d.reason,
    amountValue: d.dispute_amount?.value ?? null,
    amountCurrency: d.dispute_amount?.currency_code ?? null,
    sellerResponseDueAt: date(d.seller_response_due_date),
    buyerResponseDueAt: date(d.buyer_response_due_date),
    transactionId: tx?.seller_transaction_id ?? null,
    buyerName: tx?.buyer?.name ?? null,
    outcome: d.dispute_outcome?.outcome_code ?? null,
    paypalCreatedAt: date(d.create_time),
    paypalUpdatedAt: date(d.update_time),
    raw: d as unknown as Prisma.InputJsonValue,
  };
  return db.dispute.upsert({ where: { id: d.dispute_id }, create: { id: d.dispute_id, ...data }, update: data });
}

/** Lists every dispute PayPal has for this merchant and refreshes each one. Returns the count. */
export async function syncAllDisputes(): Promise<number> {
  const list = await paypal<{ items?: { dispute_id: string }[] }>("GET", "/v1/customer/disputes?page_size=50");
  const items = list.items ?? [];
  for (const item of items) await upsertDisputeFromPayPal(item.dispute_id);
  return items.length;
}

/**
 * Which actions PayPal currently allows on this dispute, read from its HATEOAS `links`.
 * The UI only shows a button when the matching link exists, so we never offer an action that
 * PayPal would reject at this stage.
 */
export function allowedActions(raw: unknown): Set<string> {
  const links = (raw as PayPalDispute | null)?.links ?? [];
  // PayPal's docs show both "send-message" and "send_message" styles; normalise to underscores.
  return new Set(links.map((l) => l.rel.toLowerCase().replace(/-/g, "_")));
}

/** Messages posted on the dispute (buyer and seller), oldest first. Buyer text is UNTRUSTED. */
export function disputeMessages(raw: unknown) {
  return [...((raw as PayPalDispute | null)?.messages ?? [])].sort((a, b) => a.time_posted.localeCompare(b.time_posted));
}
