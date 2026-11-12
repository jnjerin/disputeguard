"use client";
/**
 * PURPOSE
 * "Sync from PayPal" button: runs the syncFromPayPal server action and shows its result.
 * The manual fallback for the webhook (same data, pulled on demand).
 */
import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { syncFromPayPal, type ActionState } from "./actions";
import { SubmitButton } from "@/components/ui";

export function SyncButton() {
  const [state, action] = useActionState<ActionState, FormData>(syncFromPayPal, null);
  return (
    <form action={action} className="flex items-center gap-3">
      {state && <span className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.message}</span>}
      <SubmitButton className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-50">
        <RefreshCw className="h-4 w-4" aria-hidden /> Sync from PayPal
      </SubmitButton>
    </form>
  );
}
