/**
 * PURPOSE
 * "Agent quality" page: the eval scorecard (from `npm run eval`) plus live production stats from
 * real agent runs. Shows that the agent is measured, not just demoed: decision accuracy against
 * labelled cases, prompt-injection catch rate, false alarms, cost and latency per dispute.
 */
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

export default async function QualityPage() {
  const latest = await db.evalResult.findFirst({ orderBy: { createdAt: "desc" }, select: { runId: true, createdAt: true } });
  const results = latest ? await db.evalResult.findMany({ where: { runId: latest.runId }, orderBy: { caseId: "asc" } }) : [];
  const runs = await db.agentRun.findMany({ where: { status: "ok" }, select: { costUsd: true, latencyMs: true, injectionDetected: true } });

  const n = results.length;
  const correct = results.filter((r) => r.correct).length;
  const inj = results.filter((r) => r.expectInjection);
  const caught = inj.filter((r) => r.gotInjection).length;
  const falseAlarms = results.filter((r) => !r.expectInjection && r.gotInjection).length;
  const avgCost = n ? results.reduce((s, r) => s + r.costUsd, 0) / n : 0;
  const avgLatency = n ? results.reduce((s, r) => s + r.latencyMs, 0) / n : 0;
  const liveCost = runs.length ? runs.reduce((s, r) => s + r.costUsd, 0) / runs.length : 0;

  const tiles = [
    { label: "Decision accuracy", value: `${correct}/${n}`, sub: pct(correct, n) },
    { label: "Injections caught", value: `${caught}/${inj.length}`, sub: pct(caught, inj.length) },
    { label: "False alarms", value: String(falseAlarms), sub: `of ${n - inj.length} clean cases` },
    { label: "Avg cost / dispute", value: `$${avgCost.toFixed(4)}`, sub: `${(avgLatency / 1000).toFixed(1)}s avg latency` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent quality</h1>
        <p className="mt-1 text-sm text-slate-600">
          Labelled eval set run against the real agent (Meta Muse Spark). {latest ? `Last run ${latest.createdAt.toLocaleString()}.` : "No eval run yet: run npm run eval."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs text-slate-500">{t.sub}</div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2">Case</th><th className="px-4 py-2">Expected</th><th className="px-4 py-2">Agent</th><th className="px-4 py-2">Injection (expected / flagged)</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">Latency</th></tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-mono text-xs">{r.caseId}</td>
                <td className="px-4 py-2 uppercase">{r.expected}</td>
                <td className={`px-4 py-2 font-medium uppercase ${r.correct ? "text-emerald-700" : "text-red-700"}`}>{r.actual ?? `error: ${r.error?.slice(0, 60)}`}</td>
                <td className="px-4 py-2">{r.expectInjection ? "yes" : "no"} / <span className={r.expectInjection === r.gotInjection ? "text-emerald-700" : "text-red-700"}>{r.gotInjection ? "yes" : "no"}</span></td>
                <td className="px-4 py-2 text-right tabular-nums">${r.costUsd.toFixed(4)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{(r.latencyMs / 1000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-600">
        Live: {runs.length} production analyses, avg ${liveCost.toFixed(4)} per dispute, {runs.filter((r) => r.injectionDetected).length} with a manipulation attempt flagged.
      </p>
    </div>
  );
}
