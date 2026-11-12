/**
 * PURPOSE
 * Small display helpers shared by the inbox grid and the dispute page: human labels for PayPal
 * reason/status codes, money formatting, and deadline urgency (the "deadline radar" colours).
 * Pure functions, safe on both server and client.
 */

const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  CANCELED_RECURRING_BILLING: "Cancelled subscription",
  PROBLEM_WITH_REMITTANCE: "Remittance problem",
  OTHER: "Other",
};

export const reasonLabel = (r: string) => REASONS[r] ?? r.replace(/_/g, " ").toLowerCase();

export const statusLabel = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function money(value?: string | null, currency?: string | null) {
  if (!value) return "-";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD" }).format(Number(value));
  } catch {
    return `${value} ${currency ?? ""}`;
  }
}

export type Urgency = "overdue" | "critical" | "soon" | "ok" | "none";

/** Deadline radar: <24 h critical, <72 h soon. */
export function urgency(due: string | Date | null | undefined, now = Date.now()): Urgency {
  if (!due) return "none";
  const ms = new Date(due).getTime() - now;
  if (ms <= 0) return "overdue";
  if (ms < 24 * 3600_000) return "critical";
  if (ms < 72 * 3600_000) return "soon";
  return "ok";
}

export function countdown(due: string | Date | null | undefined, now = Date.now()): string {
  if (!due) return "No deadline";
  let s = Math.floor((new Date(due).getTime() - now) / 1000);
  if (s <= 0) return "Overdue";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m` : `${h}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}

export const URGENCY_CLASSES: Record<Urgency, string> = {
  overdue: "bg-red-600 text-white",
  critical: "bg-red-100 text-red-800",
  soon: "bg-amber-100 text-amber-800",
  ok: "bg-emerald-100 text-emerald-800",
  none: "bg-slate-100 text-slate-600",
};
