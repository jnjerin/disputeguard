/**
 * PURPOSE
 * The disputes inbox (home page). Server component: reads disputes + each one's latest agent run
 * from Postgres, computes the headline tiles (open disputes, due within 72 h, money at risk,
 * injection attempts), and hands rows to the AG Grid inbox.
 */
import { db } from "@/lib/db";
import { money } from "@/lib/format";
import { InboxGrid, type InboxRow } from "./inbox-grid";
import { SyncButton } from "./sync-button";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const disputes = await db.dispute.findMany({
    orderBy: { sellerResponseDueAt: "asc" },
    include: {
      agentRuns: { where: { status: "ok" }, orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { evidence: true } },
    },
  });

  const rows: InboxRow[] = disputes.map((d) => ({
    id: d.id,
    buyer: d.buyerName,
    reason: d.reason,
    status: d.status,
    stage: d.stage,
    amountValue: d.amountValue,
    amountCurrency: d.amountCurrency,
    due: d.sellerResponseDueAt?.toISOString() ?? null,
    decision: d.agentRuns[0]?.decision ?? null,
    confidence: d.agentRuns[0]?.confidence ?? null,
    injection: d.agentRuns[0]?.injectionDetected ?? false,
    evidenceCount: d._count.evidence,
    createdAt: d.paypalCreatedAt?.toISOString() ?? null,
  }));

  const open = disputes.filter((d) => d.status !== "RESOLVED");
  const now = Date.now();
  const dueSoon = open.filter((d) => d.sellerResponseDueAt && d.sellerResponseDueAt.getTime() - now < 72 * 3600_000).length;
  const atRisk = open.reduce((s, d) => s + Number(d.amountValue ?? 0), 0);
  const injections = rows.filter((r) => r.injection).length;

  const tiles = [
    { label: "Open disputes", value: String(open.length) },
    { label: "Due within 72 h", value: String(dueSoon), warn: dueSoon > 0 },
    { label: "Money at risk", value: money(String(atRisk), open[0]?.amountCurrency ?? "USD") },
    { label: "Manipulation attempts blocked", value: String(injections), warn: injections > 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Disputes</h1>
          <p className="mt-1 text-sm text-slate-600">
            New PayPal disputes arrive by webhook and are investigated automatically. Nothing is sent to PayPal until you approve it.
          </p>
        </div>
        <SyncButton />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${t.warn ? "text-red-600" : "text-slate-900"}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <InboxGrid rows={rows} />
    </div>
  );
}
