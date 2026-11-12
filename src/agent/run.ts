/**
 * PURPOSE
 * Runs the agent on a real (sandbox) dispute and stores the result as an AgentRun.
 * Builds the AgentContext from our database (dispute record, uploaded evidence) and PayPal
 * (the disputed payment's capture record, read-only), then saves the verdict, the step trace,
 * tokens, cost and latency. Failures are stored too, so the UI can show what went wrong.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { paypal } from "@/lib/paypal";
import { runAgent, type AgentContext } from "./core";

export async function analyzeDispute(disputeId: string, opts: { trigger: "webhook" | "button" }) {
  const dispute = await db.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: { evidence: true } });

  const ctx: AgentContext = {
    disputeId,
    dispute: dispute.raw as Record<string, any>,
    getTransaction: async () => {
      // The seller transaction id of a PayPal checkout payment is its capture id.
      if (!dispute.transactionId) return { note: "No seller transaction id on this dispute." };
      try {
        return await paypal("GET", `/v2/payments/captures/${encodeURIComponent(dispute.transactionId)}`);
      } catch (e) {
        return { note: `Capture record not available: ${(e as Error).message.slice(0, 200)}` };
      }
    },
    evidence: dispute.evidence.map((e) => ({ id: e.id, filename: e.filename, mimeType: e.mimeType, data: Buffer.from(e.data) })),
  };

  const started = Date.now();
  try {
    const r = await runAgent(ctx);
    return await db.agentRun.create({
      data: {
        disputeId,
        status: "ok",
        model: r.model,
        decision: r.verdict.decision,
        confidence: r.verdict.confidence,
        injectionDetected: r.injectionDetected,
        verdict: { ...r.verdict, prescan: r.prescan, trigger: opts.trigger } as unknown as Prisma.InputJsonValue,
        steps: r.steps as unknown as Prisma.InputJsonValue,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
      },
    });
  } catch (e) {
    await db.agentRun.create({
      data: {
        disputeId,
        status: "error",
        model: process.env.META_MODEL ?? "unknown",
        steps: [],
        latencyMs: Date.now() - started,
        error: (e as Error).message.slice(0, 1000),
      },
    });
    throw e;
  }
}
