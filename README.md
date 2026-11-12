# DisputeGuard

**An AI dispute analyst for PayPal merchants.** When a buyer opens a dispute, DisputeGuard hears
about it through a PayPal webhook, investigates it with the merchant's evidence using Meta's
Muse Spark model, and returns a case file: **fight or settle**, a confidence score, reasons that
each cite their source, missing evidence, risks and a draft response. Nothing is sent to PayPal
until the merchant reviews it and clicks approve.

Small merchants lose disputes they could have won because responding takes time they don't have:
reading the claim, finding the tracking number, writing a reply before the deadline. DisputeGuard
does the investigation and leaves the decision with the merchant.

> Sandbox only. This app refuses to talk to any PayPal host other than `api-m.sandbox.paypal.com`.

## What it does

1. **Hears disputes.** `POST /api/webhooks/paypal` reads the raw body, de-duplicates by event id,
   verifies the signature with PayPal's `verify-webhook-signature` API, stores the dispute, and
   starts an analysis in the background.
2. **Investigates.** The agent runs a bounded, read-only tool loop (at most 6 steps) over
   `get_dispute`, `get_transaction`, `list_evidence` and `read_evidence`. Evidence can be PDFs and
   images (shipping labels, tracking pages, receipts); Muse Spark reads them directly.
3. **Decides.** A separate call returns a strict-JSON verdict (validated with zod): decision,
   confidence, cited reasons, missing evidence, risks, prompt-injection findings, the recommended
   PayPal action and a draft message.
4. **Waits for a human.** The dispute page shows the case file, the agent's step-by-step trace,
   the buyer conversation and an approval panel. Only the actions PayPal currently allows for the
   dispute (from its HATEOAS links) are offered. Accepting a claim requires typing `REFUND`.
5. **Acts and records.** On approval the server re-fetches the dispute, re-checks the action is
   allowed, calls the PayPal Disputes API, and writes an audit event.

### Safety

- **Human approval before money moves.** The agent has read-only tools; every PayPal write is a
  server action triggered by a click, re-validated on the server and audit-logged.
- **Prompt-injection defense.** Buyer messages and evidence text are wrapped as untrusted data, a
  regex pre-scan flags instructions aimed at the AI, and the model reports any manipulation it
  finds. The case file shows the quoted attempt to the merchant.
- **Sandbox guard.** `src/lib/env.ts` refuses any non-sandbox PayPal host.
- **No secrets in git.** A pre-commit hook (`scripts/check-secrets.mjs`) blocks `.env` files,
  real credential values and live PayPal hosts.

### Agent quality

`npm run eval` runs the agent on 8 labelled dispute scenarios (genuine claims, strong and weak
evidence, injection attempts) and stores the results, shown on the **Agent quality** page.
Latest run: 8/8 correct decisions, 3/3 injection attempts caught, 0 false alarms, about
$0.017 per dispute.

## Tech

| Part | Used for |
|---|---|
| Meta Muse Spark (`muse-spark-1.3`, Meta Model API) | Tool-calling investigation, PDF and image reading, strict JSON verdicts |
| PayPal Disputes API v1 | List, read, send message, provide evidence, accept claim, escalate |
| PayPal Webhooks | Dispute created / updated / resolved events with signature verification |
| PayPal Orders v2 | Creating sandbox test purchases to dispute |
| Next.js (App Router), React 19, TypeScript, Tailwind | Dashboard and server actions |
| AG Grid Community | Dispute inbox with deadline countdowns |
| Prisma + PostgreSQL | Disputes, evidence, agent runs, audit log, webhook events, eval results |
| Render | Web service and Postgres (`render.yaml` Blueprint) |

All API calls are plain `fetch`, no vendor SDKs, so the HTTP behaviour is visible in the code
(`src/lib/paypal.ts`, `src/lib/meta.ts`).

## Run it locally

Requirements: Node 20+, a PostgreSQL database, a PayPal **sandbox** REST app (developer.paypal.com)
and a Meta Model API key.

```bash
cp .env.example .env      # fill in the values (see below)
npm install
npm run db:migrate        # create the tables
npm run dev               # http://localhost:3000
```

`.env`:

| Variable | Value |
|---|---|
| `MODEL_API_KEY` | Meta Model API key |
| `META_BASE_URL` | `https://api.meta.ai/v1` |
| `META_MODEL` | `muse-spark-1.3` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Your sandbox app's credentials |
| `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` |
| `PAYPAL_WEBHOOK_ID` | The id PayPal shows after you register the webhook |
| `DATABASE_URL` | PostgreSQL connection string |

`GET /api/health?meta=1` shows which Meta models the server's key can reach (the key itself is
never shown). Meta serves the model list by request origin; if it is empty, run the analysis from
a location where Muse Spark is available.

## Test it in the PayPal sandbox

1. **Create purchases to dispute:** `npm run seed:orders` prints two approval links. Open each in
   a private window, log in as your sandbox **personal** (buyer) account and pay. Then run
   `npm run seed:orders -- capture`.
2. **Register the webhook:** in your sandbox app's settings, add a webhook pointing to
   `https://<your-host>/api/webhooks/paypal` with the `Customer dispute created`, `updated` and
   `resolved` events. Put its id in `PAYPAL_WEBHOOK_ID`.
3. **File a dispute:** log in to sandbox PayPal as the buyer, open the payment, choose
   *Report a problem*, and say the item never arrived. For the injection demo, write a message
   that tells the AI to approve a refund.
4. **Watch it arrive:** the dispute appears in the inbox with the agent's case file. (No public
   host? Click **Sync from PayPal** in the inbox.)
5. **Add evidence:** `npm run make:evidence` writes sample tracking PDFs and a receipt to
   `evidence-samples/`. Upload one on the dispute page and click **Analyze** again.
6. **Approve an action:** send the drafted message or provide the evidence from the approval
   panel, then check the audit log.

## Deploy

`render.yaml` is a Render Blueprint: a web service that runs migrations on start, plus a health
check at `/api/health`. Set the secret variables in the Render dashboard.

## Project layout

```
app/                  Next.js pages, server actions, webhook and health routes
src/agent/            Investigation loop, verdict schema, injection scan
src/lib/              PayPal and Meta clients, env validation, webhook verification
prisma/               Schema and migrations
evals/                Labelled scenarios and the eval runner
scripts/              Sandbox order seeding, evidence samples, secret check
spikes/gate-check/    Early API feasibility checks
```

## License

MIT, see [LICENSE](LICENSE).
