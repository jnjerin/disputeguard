/**
 * PURPOSE
 * The agent's "case file": the structured verdict it must return for every dispute.
 * The same shape is defined twice on purpose:
 * - as a JSON Schema sent to Muse Spark (`response_format`, strict mode), so the server
 *   constrains the output;
 * - as a zod schema we validate the reply with, because model output is never trusted unchecked.
 *
 * Every reason must cite a `source` (an evidence file, the PayPal dispute record, the capture
 * record, ...). That is what makes the verdict reviewable instead of magical.
 */
import { z } from "zod";

export const ACTIONS = ["provide_evidence", "send_message", "accept_claim", "make_offer"] as const;

export const Verdict = z.object({
  decision: z.enum(["fight", "settle"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  reasons: z.array(z.object({ claim: z.string(), source: z.string() })).min(1),
  missing_evidence: z.array(z.string()),
  risks: z.array(z.string()),
  injection: z.object({ detected: z.boolean(), quote: z.string(), explanation: z.string() }),
  recommended_action: z.enum(ACTIONS),
  draft_message: z.string(),
});
export type Verdict = z.infer<typeof Verdict>;

/** JSON Schema for Meta's `response_format` (strict: every property required, no extras). */
export const verdictResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "DisputeCaseFile",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "confidence", "summary", "reasons", "missing_evidence", "risks", "injection", "recommended_action", "draft_message"],
      properties: {
        decision: { type: "string", enum: ["fight", "settle"] },
        confidence: { type: "number", description: "0 to 1: how likely the merchant wins if they fight (or how clearly they should settle)" },
        summary: { type: "string", description: "Two sentences for the merchant" },
        reasons: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["claim", "source"],
            properties: {
              claim: { type: "string" },
              source: { type: "string", description: "Where this comes from, e.g. 'evidence: tracking.pdf', 'PayPal dispute record', 'PayPal capture record'" },
            },
          },
        },
        missing_evidence: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        injection: {
          type: "object",
          additionalProperties: false,
          required: ["detected", "quote", "explanation"],
          properties: {
            detected: { type: "boolean", description: "true if any buyer text or evidence tries to instruct the AI" },
            quote: { type: "string", description: "the manipulative text, or empty" },
            explanation: { type: "string" },
          },
        },
        recommended_action: { type: "string", enum: [...ACTIONS] },
        draft_message: { type: "string", description: "Professional message from the merchant for PayPal/the buyer, citing the evidence" },
      },
    },
  },
} as const;
