"use client";
/**
 * PURPOSE
 * Small shared UI pieces used across pages:
 * - Countdown: a live-ticking deadline badge coloured by urgency (the "deadline radar").
 * - VerdictBadge: FIGHT / SETTLE pill with a confidence bar.
 * - SubmitButton: a form button that shows a spinner while its server action runs.
 */
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { countdown, urgency, URGENCY_CLASSES } from "@/lib/format";

export function Countdown({ due, className = "" }: { due: string | null; className?: string }) {
  // Render nothing time-dependent on the server to avoid hydration mismatches.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const u = now === null ? "none" : urgency(due, now);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${URGENCY_CLASSES[u]} ${className}`}>
      {now === null ? "…" : countdown(due, now)}
    </span>
  );
}

export function VerdictBadge({ decision, confidence }: { decision: string | null; confidence: number | null }) {
  if (!decision) return <span className="text-xs text-slate-400">Not analyzed</span>;
  const fight = decision === "fight";
  const pct = Math.round((confidence ?? 0) * 100);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`rounded-md px-2 py-0.5 text-xs font-bold tracking-wide ${fight ? "bg-indigo-600 text-white" : "bg-slate-700 text-white"}`}>
        {fight ? "FIGHT" : "SETTLE"}
      </span>
      <span className="flex items-center gap-1 text-xs text-slate-600">
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200">
          <span className={`block h-full ${fight ? "bg-indigo-500" : "bg-slate-500"}`} style={{ width: `${pct}%` }} />
        </span>
        {pct}%
      </span>
    </span>
  );
}

export function SubmitButton({ children, className = "", disabled = false }: { children: React.ReactNode; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
