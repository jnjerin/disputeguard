"use server";
/**
 * PURPOSE
 * Server actions for one dispute. This file is THE MONEY GATE: the only place in the app that
 * writes to PayPal, and every write here runs only because a merchant clicked a button.
 *
 * Read / local actions:  analyze (run the agent), uploadEvidence, refresh
 * PayPal writes:         sendMessage, provideEvidence, acceptClaim (moves money; needs typed
 *                        confirmation), escalate, adjudicate (SANDBOX-ONLY demo helper)
 *
 * Every PayPal write:
 *  1. re-reads the dispute from PayPal and checks the action is in its HATEOAS `links`
 *     (never attempt what PayPal says is not allowed at this stage),
 *  2. performs the call,
 *  3. records an AuditEvent (who, what, amount, result, PayPal's answer), success or failure,
 *  4. refreshes the dispute from PayPal.
 *
 * Request shapes follow PayPal's Disputes v1 docs/examples
 * (https://developer.paypal.com/docs/api/customer-disputes/v1/).
 */
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { analyzeDispute } from "@/agent/run";
import { db } from "@/lib/db";
import { allowedActions, upsertDisputeFromPayPal } from "@/lib/disputes";
import { paypal, PayPalError } from "@/lib/paypal";

export type ActionState = { ok: boolean; message: string } | null;

/** Single demo merchant for the MVP (no login yet; see README). */
const ACTOR = "demo-merchant";
const MAX_UPLOAD = 4 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/gif"];

const path = (id: string) => `/disputes/${encodeURIComponent(id)}`;
const errMsg = (e: unknown) => (e instanceof PayPalError ? `PayPal said HTTP ${e.status}: ${e.body.slice(0, 300)}` : (e as Error).message.slice(0, 300));

/** Runs a PayPal write behind the link check, with an audit record either way. */
async function guardedWrite(
  disputeId: string,
  action: string,
  linkRel: string,
  detail: Record<string, unknown>,
  call: () => Promise<unknown>,
  amount?: string | null,
): Promise<ActionState> {
  try {
    const fresh = await upsertDisputeFromPayPal(disputeId);
    if (!allowedActions(fresh.raw).has(linkRel)) {
      throw new Error(`PayPal does not allow "${action}" at this stage (status ${fresh.status}, stage ${fresh.stage ?? "-"}).`);
    }
    const response = await call();
    await db.auditEvent.create({
      data: { disputeId, action, actor: ACTOR, amount: amount ?? null, result: "ok", detail: { ...detail, response } as Prisma.InputJsonValue },
    });
    await upsertDisputeFromPayPal(disputeId);
    revalidatePath(path(disputeId));
    return { ok: true, message: `${action} accepted by PayPal` };
  } catch (e) {
    await db.auditEvent.create({
      data: { disputeId, action, actor: ACTOR, amount: amount ?? null, result: "error", detail: { ...detail, error: errMsg(e) } as Prisma.InputJsonValue },
    });
    revalidatePath(path(disputeId));
    return { ok: false, message: errMsg(e) };
  }
}

// ---------- read / local ----------

export async function analyze(disputeId: string, _prev: ActionState): Promise<ActionState> {
  try {
    const run = await analyzeDispute(disputeId, { trigger: "button" });
    revalidatePath(path(disputeId));
    revalidatePath("/");
    return { ok: true, message: `Case file ready: ${run.decision?.toUpperCase()} (${Math.round((run.confidence ?? 0) * 100)}%)` };
  } catch (e) {
    revalidatePath(path(disputeId));
    return { ok: false, message: (e as Error).message.slice(0, 300) };
  }
}

export async function refresh(disputeId: string, _prev: ActionState): Promise<ActionState> {
  try {
    await upsertDisputeFromPayPal(disputeId);
    revalidatePath(path(disputeId));
    return { ok: true, message: "Refreshed from PayPal" };
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}

export async function uploadEvidence(disputeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, message: "Choose at least one file" };
  for (const f of files) {
    if (!ALLOWED_TYPES.includes(f.type)) return { ok: false, message: `${f.name}: only PDF, PNG, JPEG or GIF` };
    if (f.size > MAX_UPLOAD) return { ok: false, message: `${f.name}: larger than 4 MB` };
  }
  for (const f of files) {
    await db.evidence.create({
      data: { disputeId, filename: f.name, mimeType: f.type, size: f.size, data: Buffer.from(await f.arrayBuffer()) },
    });
  }
  revalidatePath(path(disputeId));
  return { ok: true, message: `Uploaded ${files.length} file(s). Re-run the analysis to include them.` };
}

export async function deleteEvidence(disputeId: string, evidenceId: string) {
  await db.evidence.delete({ where: { id: evidenceId } });
  revalidatePath(path(disputeId));
}

// ---------- PayPal writes (human-approved) ----------

export async function sendMessage(disputeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const message = String(form.get("message") ?? "").trim();
  if (!message) return { ok: false, message: "Message is empty" };
  if (message.length > 2000) return { ok: false, message: "PayPal allows at most 2000 characters" };
  return guardedWrite(disputeId, "send-message", "send_message", { message }, () =>
    paypal("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-message`, { message }),
  );
}

export async function provideEvidence(disputeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const notes = String(form.get("notes") ?? "").trim().slice(0, 2000);
  const carrier = String(form.get("carrier") ?? "").trim().toUpperCase().replace(/[^0-9A-Z_]/g, "_");
  const tracking = String(form.get("tracking") ?? "").trim();
  const evidenceIds = form.getAll("evidenceIds").map(String);
  const files = evidenceIds.length ? await db.evidence.findMany({ where: { id: { in: evidenceIds }, disputeId } }) : [];

  const evidence = tracking
    ? { evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: carrier || "OTHER", tracking_number: tracking }] }, notes: notes || "Proof of delivery attached." }
    : { evidence_type: "OTHER", notes: notes || "Supporting documents attached." };
  const input = { evidences: [evidence] };

  return guardedWrite(
    disputeId,
    "provide-evidence",
    "provide_evidence",
    { input, files: files.map((f) => f.filename) },
    () => {
      // Multipart: an "input" JSON part plus one "evidence-file" part per document.
      const body = new FormData();
      body.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
      for (const f of files) body.append("evidence-file", new Blob([Buffer.from(f.data)], { type: f.mimeType }), f.filename);
      return paypal("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, body);
    },
  );
}

export async function acceptClaim(disputeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  // Moving money needs a typed confirmation, checked on the server (not just in the browser).
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "REFUND") {
    return { ok: false, message: 'Type REFUND to confirm. This refunds the buyer.' };
  }
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || "Merchant accepted the claim.";
  const d = await db.dispute.findUnique({ where: { id: disputeId } });
  return guardedWrite(
    disputeId,
    "accept-claim",
    "accept_claim",
    { note, accept_claim_type: "REFUND" },
    () => paypal("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`, { note, accept_claim_type: "REFUND" }),
    d ? `${d.amountValue} ${d.amountCurrency}` : null,
  );
}

export async function escalate(disputeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const note = String(form.get("note") ?? "").trim().slice(0, 2000) || "The merchant has proof of delivery and asks PayPal to review.";
  return guardedWrite(disputeId, "escalate", "escalate", { note }, () =>
    paypal("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/escalate`, { note }),
  );
}

/** SANDBOX ONLY: asks PayPal's sandbox to decide the dispute (demo helper, status UNDER_REVIEW). */
export async function adjudicate(disputeId: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR", _prev: ActionState): Promise<ActionState> {
  return guardedWrite(disputeId, `adjudicate (${outcome})`, "adjudicate", { adjudication_outcome: outcome }, () =>
    paypal("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/adjudicate`, { adjudication_outcome: outcome }),
  );
}
