/**
 * PURPOSE
 * One dispute's page: everything the merchant needs to decide, on one screen.
 * - Header: amount, reason, status/stage, live deadline countdown, refresh from PayPal
 * - AI case file: FIGHT/SETTLE + confidence, summary, reasons with SOURCE chips, missing
 *   evidence, risks, prompt-injection alert, the agent's step trace, tokens/cost/latency
 * - Evidence: upload receipts/tracking (image/PDF) that the agent reads
 * - Conversation: messages on the dispute (buyer text shown as-is, never executed)
 * - Your decision: the approval gate (forms.tsx); audit trail of every PayPal write
 * - Sandbox tools: escalate + adjudicate, clearly labelled, to show resolution in the demo
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Bot, FileText, FlaskConical, ImageIcon, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import type { AgentStep } from "@/agent/core";
import type { Verdict } from "@/agent/verdict";
import { Countdown, FilePicker, SubmitButton, VerdictBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { allowedActions, disputeMessages } from "@/lib/disputes";
import { money, reasonLabel, statusLabel } from "@/lib/format";
import * as A from "./actions";
import { ActionForm, ApprovalPanel } from "./forms";

export const dynamic = "force-dynamic";

const Card = ({ title, icon, children, right }: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <h2 className="flex items-center gap-2 font-semibold">{icon}{title}</h2>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </section>
);

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const disputeId = decodeURIComponent(id);
  const d = await db.dispute.findUnique({
    where: { id: disputeId },
    include: {
      evidence: { select: { id: true, filename: true, mimeType: true, size: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      agentRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      auditEvents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!d) notFound();

  const run = d.agentRuns[0];
  const verdict = run?.status === "ok" ? (run.verdict as unknown as Verdict & { prescan?: { pattern: string; quote: string }[] }) : null;
  const steps = (run?.steps as unknown as AgentStep[]) ?? [];
  const allowed = [...allowedActions(d.raw)];
  const messages = disputeMessages(d.raw);

  return (
    <div className="space-y-5">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" aria-hidden /> Inbox</Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="font-mono text-xs text-slate-500">{d.id}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {money(d.amountValue, d.amountCurrency)} · {reasonLabel(d.reason)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="rounded-full bg-slate-100 px-2 py-0.5">{statusLabel(d.status)}</span>
            {d.stage && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide">{d.stage}</span>}
            {d.buyerName && <span>Buyer: {d.buyerName}</span>}
            {d.transactionId && <span className="font-mono text-xs">Txn {d.transactionId}</span>}
            {d.outcome && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">Outcome: {statusLabel(d.outcome)}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Response due</div>
          <Countdown due={d.sellerResponseDueAt?.toISOString() ?? null} className="text-sm" />
          <ActionForm action={A.refresh.bind(null, d.id)}>
            <SubmitButton className="border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh from PayPal</SubmitButton>
          </ActionForm>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Left: case file */}
        <div className="space-y-5 lg:col-span-3">
          <Card
            title="AI case file"
            icon={<Sparkles className="h-4 w-4 text-brand-600" aria-hidden />}
            right={
              <ActionForm action={A.analyze.bind(null, d.id)}>
                <SubmitButton className="bg-slate-900 text-white hover:bg-slate-700"><Bot className="h-4 w-4" aria-hidden /> {run ? "Re-analyze" : "Analyze"}</SubmitButton>
              </ActionForm>
            }
          >
            {run?.status === "error" && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Last analysis failed: {run.error}</p>}
            {!verdict && run?.status !== "error" && <p className="text-sm text-slate-500">Not analyzed yet. Upload evidence, then click Analyze. The agent reads the dispute, the payment and your files with Meta Muse Spark.</p>}
            {verdict && (
              <div className="space-y-4">
                {run?.injectionDetected && (
                  <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
                    <div>
                      <div className="font-semibold">Manipulation attempt detected and ignored</div>
                      {verdict.injection.quote && <blockquote className="mt-1 border-l-2 border-red-300 pl-2 italic">“{verdict.injection.quote}”</blockquote>}
                      <p className="mt-1 text-red-800">{verdict.injection.explanation || "Buyer text tried to instruct the AI. It was treated as data; the verdict is based on evidence only."}</p>
                      {!!verdict.prescan?.length && <p className="mt-1 text-xs text-red-700">Independent pattern scan: {verdict.prescan.map((p) => p.pattern).join("; ")}</p>}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <VerdictBadge decision={verdict.decision} confidence={verdict.confidence} />
                  <span className="text-xs text-slate-500">Recommended action: <strong>{verdict.recommended_action.replace(/_/g, " ")}</strong></span>
                </div>
                <p className="text-sm text-slate-800">{verdict.summary}</p>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reasons</h3>
                  <ul className="mt-2 space-y-2">
                    {verdict.reasons.map((r, i) => (
                      <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
                        <span className="text-slate-800">{r.claim}</span>
                        <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">source: {r.source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {verdict.missing_evidence.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing evidence</h3>
                    <ul className="mt-1 list-disc pl-5 text-sm text-slate-700">{verdict.missing_evidence.map((m, i) => <li key={i}>{m}</li>)}</ul>
                  </div>
                )}
                {verdict.risks.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Risks</h3>
                    <ul className="mt-1 space-y-1 text-sm text-slate-700">{verdict.risks.map((m, i) => <li key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />{m}</li>)}</ul>
                  </div>
                )}
                <details className="rounded-lg bg-slate-50 p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-slate-700">Agent trace ({steps.length} steps) · {run?.inputTokens.toLocaleString()} in / {run?.outputTokens.toLocaleString()} out tokens · ${run?.costUsd.toFixed(4)} · {((run?.latencyMs ?? 0) / 1000).toFixed(1)}s · {run?.model}</summary>
                  <ol className="mt-2 space-y-1.5">
                    {steps.map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs">
                        <span className={`w-12 shrink-0 rounded px-1 text-center font-mono ${s.kind === "tool" ? "bg-indigo-100 text-indigo-700" : s.kind === "note" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>{s.kind}</span>
                        <span className="font-medium text-slate-800">{s.name}</span>
                        <span className="truncate text-slate-500">{s.detail}</span>
                        {s.ms !== undefined && <span className="ml-auto shrink-0 text-slate-400">{s.ms}ms</span>}
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            )}
          </Card>

          <Card title="Conversation" icon={<FileText className="h-4 w-4 text-slate-500" aria-hidden />}>
            {messages.length === 0 && <p className="text-sm text-slate-500">No messages on this dispute yet.</p>}
            <ul className="space-y-3">
              {messages.map((m, i) => (
                <li key={i} className={`rounded-lg p-3 text-sm ${m.posted_by === "SELLER" ? "ml-8 bg-indigo-50" : "mr-8 bg-slate-50"}`}>
                  <div className="mb-1 text-xs text-slate-500">{m.posted_by} · {new Date(m.time_posted).toLocaleString()}</div>
                  <div className="whitespace-pre-wrap text-slate-800">{m.content}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Right: evidence, decision, audit */}
        <div className="space-y-5 lg:col-span-2">
          <Card title="Evidence" icon={<ImageIcon className="h-4 w-4 text-slate-500" aria-hidden />}>
            <ul className="mb-3 space-y-1.5">
              {d.evidence.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">{e.mimeType === "application/pdf" ? <FileText className="h-4 w-4 text-red-500" aria-hidden /> : <ImageIcon className="h-4 w-4 text-sky-500" aria-hidden />}{e.filename}</span>
                  <span className="text-xs text-slate-400">{Math.ceil(e.size / 1024)} KB</span>
                </li>
              ))}
            </ul>
            <ActionForm action={A.uploadEvidence.bind(null, d.id)} className="space-y-2">
              <FilePicker name="files" accept="application/pdf,image/png,image/jpeg,image/gif" />
              <SubmitButton className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-50">Upload</SubmitButton>
            </ActionForm>
          </Card>

          <ApprovalPanel key={run?.id ?? "none"}
            draft={verdict?.draft_message ?? ""}
            evidence={d.evidence.map((e) => ({ id: e.id, filename: e.filename }))}
            allowed={allowed}
            recommended={verdict?.recommended_action ?? null}
            sendMessage={A.sendMessage.bind(null, d.id)}
            provideEvidence={A.provideEvidence.bind(null, d.id)}
            acceptClaim={A.acceptClaim.bind(null, d.id)}
          />

          <Card title="Audit trail">
            {d.auditEvents.length === 0 && <p className="text-sm text-slate-500">No actions sent to PayPal yet.</p>}
            <ul className="space-y-2">
              {d.auditEvents.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${a.result === "ok" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{a.result}</span>
                  <span className="font-medium">{a.action}</span>
                  <span className="text-slate-500"> by {a.actor} · {a.createdAt.toLocaleString()}</span>
                  {a.result !== "ok" && <div className="mt-0.5 text-xs text-red-700">{String((a.detail as { error?: string }).error ?? "")}</div>}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Sandbox tools" icon={<FlaskConical className="h-4 w-4 text-amber-600" aria-hidden />}>
            <p className="mb-3 text-xs text-slate-500">Demo helpers that exist only in the PayPal sandbox. Allowed now: {allowed.join(", ") || "none"}.</p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={A.escalate.bind(null, d.id)}>
                <SubmitButton disabled={!allowed.includes("escalate")} className="border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50">Escalate to claim</SubmitButton>
              </ActionForm>
              <ActionForm action={A.adjudicate.bind(null, d.id, "SELLER_FAVOR")}>
                <SubmitButton disabled={!allowed.includes("adjudicate")} className="border border-amber-300 bg-amber-50 text-xs text-amber-900 hover:bg-amber-100">Adjudicate: seller wins</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
