"use client";
/**
 * PURPOSE
 * Interactive pieces of the dispute page (client components):
 * - ActionForm: wraps any server action with a result message (success green, error red).
 * - ApprovalPanel: the human-in-the-loop gate. The merchant edits the AI's draft, picks evidence
 *   and clicks Approve; only then does a PayPal write happen. Settling needs typing REFUND.
 * Buttons for actions PayPal does not allow at this stage are disabled with an explanation.
 */
import { useActionState, useState } from "react";
import { CheckCircle2, FileUp, Gavel, MessageSquare, Send, Undo2 } from "lucide-react";
import { SubmitButton } from "@/components/ui";
import type { ActionState } from "./actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function ActionForm({ action, children, className = "" }: { action: Action; children: React.ReactNode; className?: string }) {
  const [state, run] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={run} className={className}>
      {children}
      {state && (
        <p className={`mt-2 text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}

const NOT_ALLOWED = "PayPal does not allow this action at the dispute's current stage";

export function ApprovalPanel(props: {
  draft: string;
  evidence: { id: string; filename: string }[];
  allowed: string[];
  sendMessage: Action;
  provideEvidence: Action;
  acceptClaim: Action;
  recommended: string | null;
}) {
  const [tab, setTab] = useState<"message" | "evidence" | "settle">(props.recommended === "accept_claim" ? "settle" : props.recommended === "provide_evidence" ? "evidence" : "message");
  const can = (rel: string) => props.allowed.includes(rel);
  const tabs = [
    { key: "message" as const, label: "Send message", icon: MessageSquare, rel: "send_message" },
    { key: "evidence" as const, label: "Provide evidence", icon: FileUp, rel: "provide_evidence" },
    { key: "settle" as const, label: "Settle (refund)", icon: Undo2, rel: "accept_claim" },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold"><Gavel className="h-4 w-4 text-brand-600" aria-hidden /> Your decision</h2>
        <span className="text-xs text-slate-500">Nothing is sent until you click approve</span>
      </div>
      <div className="flex gap-1 border-b border-slate-100 px-2 pt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm ${tab === t.key ? "border-b-2 border-brand-600 font-medium text-brand-700" : "text-slate-500 hover:text-slate-800"}`}
          >
            <t.icon className="h-4 w-4" aria-hidden />
            {t.label}
            {!can(t.rel) && <span className="text-[10px] text-slate-400">(n/a)</span>}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === "message" && (
          <ActionForm action={props.sendMessage} className="space-y-3">
            <label className="block text-xs font-medium text-slate-600" htmlFor="message">Message to the buyer and PayPal (AI draft, edit freely)</label>
            <textarea id="message" name="message" defaultValue={props.draft} rows={7} maxLength={2000} className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-brand-500 focus:outline-none" />
            <SubmitButton disabled={!can("send_message")} className="bg-brand-600 text-white hover:bg-brand-700">
              <Send className="h-4 w-4" aria-hidden /> Approve &amp; send message
            </SubmitButton>
            {!can("send_message") && <p className="text-xs text-slate-500">{NOT_ALLOWED}.</p>}
          </ActionForm>
        )}

        {tab === "evidence" && (
          <ActionForm action={props.provideEvidence} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600">Carrier
                <input name="carrier" defaultValue="DHL" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-600">Tracking number
                <input name="tracking" placeholder="e.g. 1Z999AA10123456784" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" />
              </label>
            </div>
            <label className="block text-xs font-medium text-slate-600">Notes for PayPal
              <textarea name="notes" defaultValue={props.draft} rows={5} maxLength={2000} className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm" />
            </label>
            <fieldset>
              <legend className="text-xs font-medium text-slate-600">Attach evidence files</legend>
              {props.evidence.length === 0 && <p className="mt-1 text-xs text-slate-500">No files uploaded yet.</p>}
              {props.evidence.map((e) => (
                <label key={e.id} className="mt-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="evidenceIds" value={e.id} defaultChecked /> {e.filename}
                </label>
              ))}
            </fieldset>
            <SubmitButton disabled={!can("provide_evidence")} className="bg-brand-600 text-white hover:bg-brand-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve &amp; submit evidence
            </SubmitButton>
            {!can("provide_evidence") && <p className="text-xs text-slate-500">{NOT_ALLOWED}.</p>}
          </ActionForm>
        )}

        {tab === "settle" && (
          <ActionForm action={props.acceptClaim} className="space-y-3">
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Accepting the claim <strong>refunds the buyer</strong> (sandbox money). Type <strong>REFUND</strong> to confirm.
            </p>
            <textarea name="note" rows={3} placeholder="Note to PayPal (optional)" className="w-full rounded-lg border border-slate-300 p-3 text-sm" />
            <input name="confirm" autoComplete="off" placeholder="Type REFUND" className="w-40 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase" />
            <div>
              <SubmitButton disabled={!can("accept_claim")} className="bg-red-600 text-white hover:bg-red-700">
                <Undo2 className="h-4 w-4" aria-hidden /> Accept claim &amp; refund
              </SubmitButton>
            </div>
            {!can("accept_claim") && <p className="text-xs text-slate-500">{NOT_ALLOWED}.</p>}
          </ActionForm>
        )}
      </div>
    </div>
  );
}
