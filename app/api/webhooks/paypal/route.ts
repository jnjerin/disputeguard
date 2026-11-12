/**
 * PURPOSE
 * POST /api/webhooks/paypal: how DisputeGuard hears about disputes automatically.
 *
 * Flow for every request:
 * 1. Read the RAW body (signature verification needs the exact bytes).
 * 2. De-duplicate by PayPal event id: PayPal retries non-2xx deliveries for up to 3 days, and
 *    processing an event twice is a bug. The event id is the WebhookEvent primary key.
 * 3. Verify the signature with PayPal. Unverified events are stored for debugging but NEVER acted on.
 * 4. For verified CUSTOMER.DISPUTE.* events, fetch the dispute from PayPal and upsert it.
 *    (We trust PayPal's API, not the webhook payload, for the dispute's data.)
 * 5. After replying, start an AI investigation in the background for new disputes. The agent is
 *    read-only toward PayPal; nothing is sent without a human click.
 * Reply 200 quickly in all handled cases so PayPal does not retry.
 */
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { upsertDisputeFromPayPal } from "@/lib/disputes";
import { verifyWebhookSignature } from "@/lib/webhook";
import { analyzeDispute } from "@/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookEvent = { id?: string; event_type?: string; resource?: { dispute_id?: string } };

export async function POST(req: Request) {
  const raw = await req.text();
  let event: WebhookEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  if (!event.id || !event.event_type) return Response.json({ error: "missing event id/type" }, { status: 400 });

  // 2. De-duplicate (fast path; the unique key below also covers concurrent retries).
  if (await db.webhookEvent.findUnique({ where: { id: event.id }, select: { id: true } })) {
    return Response.json({ ok: true, duplicate: true });
  }

  // 3. Verify.
  const v = await verifyWebhookSignature(raw, req.headers);
  const disputeId = event.resource?.dispute_id ?? null;
  try {
    await db.webhookEvent.create({
      data: {
        id: event.id,
        eventType: event.event_type,
        resourceId: disputeId,
        verified: v.verified,
        verifyStatus: v.status,
        raw: JSON.parse(raw) as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return Response.json({ ok: true, duplicate: true });
    }
    throw e;
  }

  if (!v.verified) {
    console.warn(`[webhook] ${event.event_type} ${event.id} NOT verified (${v.status}); stored, not processed`);
    return Response.json({ ok: true, verified: false });
  }

  // 4. Refresh the dispute from PayPal.
  if (event.event_type.startsWith("CUSTOMER.DISPUTE.") && disputeId) {
    await upsertDisputeFromPayPal(disputeId);
    console.log(`[webhook] ${event.event_type} ${disputeId} verified and stored`);

    // 5. New dispute: investigate in the background so the case file is ready when the merchant looks.
    if (event.event_type === "CUSTOMER.DISPUTE.CREATED") {
      after(async () => {
        try {
          await analyzeDispute(disputeId, { trigger: "webhook" });
        } catch (err) {
          console.error(`[webhook] auto-analysis failed for ${disputeId}:`, (err as Error).message);
        }
      });
    }
  }

  return Response.json({ ok: true, verified: true });
}
