/**
 * PURPOSE
 * `npm run eval`: runs the real agent (src/agent/core.ts, real Muse Spark calls) on every
 * labelled case in evals/cases.ts and scores it:
 *   - decision accuracy (fight/settle matches the label)
 *   - injection catch rate (agent or pre-scan flagged every case that contains an injection)
 *   - false alarms (flagged an injection where there was none)
 *   - cost and latency per case
 * Results go to the EvalResult table (shown on the /quality page) when DATABASE_URL is set, and
 * always to logs/evals-<time>.json.
 *
 * USAGE
 *   npm run eval                       all cases
 *   npm run eval -- inr-delivered      only the named case(s) (cheap smoke test)
 */
import "../scripts/load-env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent, type EvidenceFile } from "../src/agent/core";
import { CASES } from "./cases";

const ROOT = resolve(import.meta.dirname, "..");
const only = process.argv.slice(2);
const cases = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
const runId = `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const mime = (f: string) => (f.endsWith(".pdf") ? "application/pdf" : "image/png");
const load = (f: string, i: number): EvidenceFile => ({
  id: `ev${i + 1}`,
  filename: f,
  mimeType: mime(f),
  data: readFileSync(resolve(ROOT, "evidence-samples", f)),
});

type Row = {
  caseId: string;
  expected: string;
  actual: string | null;
  expectInjection: boolean;
  gotInjection: boolean;
  correct: boolean;
  costUsd: number;
  latencyMs: number;
  error: string | null;
};
const rows: Row[] = [];

for (const c of cases) {
  process.stdout.write(`${c.id.padEnd(28)} `);
  try {
    const r = await runAgent({
      disputeId: String(c.dispute.dispute_id),
      dispute: c.dispute,
      getTransaction: async () => c.transaction,
      evidence: c.evidence.map(load),
    });
    const row: Row = {
      caseId: c.id,
      expected: c.expected,
      actual: r.verdict.decision,
      expectInjection: c.expectInjection,
      gotInjection: r.injectionDetected,
      correct: r.verdict.decision === c.expected,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      error: null,
    };
    rows.push(row);
    console.log(
      `${row.correct ? "PASS" : "FAIL"}  expected=${c.expected} got=${row.actual} (${r.verdict.confidence})  ` +
        `injection expected=${c.expectInjection} got=${row.gotInjection}  $${r.costUsd.toFixed(4)}  ${r.latencyMs}ms  steps=${r.steps.length}`,
    );
  } catch (e) {
    rows.push({ caseId: c.id, expected: c.expected, actual: null, expectInjection: c.expectInjection, gotInjection: false, correct: false, costUsd: 0, latencyMs: 0, error: (e as Error).message });
    console.log(`ERROR ${(e as Error).message.slice(0, 300)}`);
  }
}

const n = rows.length;
const acc = rows.filter((r) => r.correct).length;
const inj = rows.filter((r) => r.expectInjection);
const caught = inj.filter((r) => r.gotInjection).length;
const falseAlarms = rows.filter((r) => !r.expectInjection && r.gotInjection).length;
const cost = rows.reduce((s, r) => s + r.costUsd, 0);
console.log(
  `\nSCORE  accuracy ${acc}/${n}  injection caught ${caught}/${inj.length}  false alarms ${falseAlarms}  ` +
    `total cost $${cost.toFixed(4)} (avg $${(cost / Math.max(n, 1)).toFixed(4)}/dispute)`,
);

mkdirSync(resolve(ROOT, "logs"), { recursive: true });
writeFileSync(resolve(ROOT, "logs", `${runId}.json`), JSON.stringify(rows, null, 2));

if (process.env.DATABASE_URL) {
  const { db } = await import("../src/lib/db");
  await db.evalResult.createMany({ data: rows.map((r) => ({ runId, ...r })) });
  await db.$disconnect();
  console.log(`saved ${n} results to the database as ${runId}`);
} else {
  console.log("DATABASE_URL not set: results saved to logs/ only");
}
