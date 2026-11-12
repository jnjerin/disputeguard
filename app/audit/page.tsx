/**
 * PURPOSE
 * Audit log: every PayPal write the app attempted (who approved it, what, when, amount, result),
 * plus the webhook events received and whether their signatures verified. The money trail.
 */
import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const [events, hooks] = await Promise.all([
    db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 50, select: { id: true, eventType: true, resourceId: true, verified: true, verifyStatus: true, receivedAt: true } }),
  ]);
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">Every action sent to PayPal, approved by a human.</p>
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Dispute</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Approved by</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Result</th></tr>
            </thead>
            <tbody>
              {events.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No actions yet.</td></tr>}
              {events.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-xs text-slate-500">{e.createdAt.toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.disputeId ? <Link className="text-brand-600 hover:underline" href={`/disputes/${encodeURIComponent(e.disputeId)}`}>{e.disputeId}</Link> : "-"}</td>
                  <td className="px-4 py-2 font-medium">{e.action}</td>
                  <td className="px-4 py-2">{e.actor}</td>
                  <td className="px-4 py-2">{e.amount ?? "-"}</td>
                  <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${e.result === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{e.result}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Webhook events</h2>
        <p className="mt-1 text-sm text-slate-600">Received from PayPal; only signature-verified events are processed. Duplicates are ignored by event id.</p>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2">Received</th><th className="px-4 py-2">Event</th><th className="px-4 py-2">Dispute</th><th className="px-4 py-2">Signature</th></tr>
            </thead>
            <tbody>
              {hooks.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">No webhook events yet.</td></tr>}
              {hooks.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-xs text-slate-500">{h.receivedAt.toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{h.eventType}</td>
                  <td className="px-4 py-2 font-mono text-xs">{h.resourceId ?? "-"}</td>
                  <td className="px-4 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${h.verified ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{h.verified ? "verified" : h.verifyStatus}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
