# Gate-check results

**Status: IN PROGRESS** (last updated 2026-11-10). Rows marked BLOCKED are waiting on a manual
step by the owner (sandbox buyer approval, filing a dispute, registering the webhook).

## Results

| Check | Result | Detail |
|---|---|---|
| 1a plain chat | PASS | `muse-spark-1.3` replied "pong" |
| 1b tool calling | PASS | returned `get_dispute_deadline({"dispute_id":"PP-D-12345"})`, used the fake tool's result in its final answer |
| 1c structured output | PASS | `{"decision":"fight","confidence":0.95,"reasons":[...]}` validated with zod |
| 1d image input | PASS | receipt.png -> `{"merchant":"SAVANNA CRAFTS LTD","amount":"48.50 USD","date":"2026-10-20"}` |
| 1e PDF input | PASS | evidence.pdf (inline `file` part) -> tracking number + delivery date correct |
| 1f latency/cost | PASS | see table below |
| 2a OAuth token (sandbox) | PASS | token includes disputes read-buyer, read-seller, update-seller, **create** scopes |
| 2b list disputes | PASS | 0 disputes (access works) |
| 2c order + capture | BLOCKED | order `1LC54288FK031554B` created; waiting for sandbox buyer approval, then `capture` |
| 2d dispute creation | BLOCKED | needs buyer to file it in the sandbox Resolution Center (see findings) |
| 2e dispute details | BLOCKED | needs 2d |
| 2f non-destructive write | BLOCKED | `send-message`, needs 2d |
| 3a receive + log raw body | PASS | self-test through the public tunnel: logged to events.jsonl, 200 returned |
| 3b signature verification | BLOCKED | needs `PAYPAL_WEBHOOK_ID` (webhook registration) |
| 3c de-duplication | PASS | same event id sent twice through the tunnel; second ignored |
| 3d tunnel | PASS | cloudflared 2026.10.7 quick tunnel (`*.trycloudflare.com`) -> localhost:8787 |
| 3e real dispute event verified | BLOCKED | needs 3b + 2d |

## Meta calls (1f)

Model `muse-spark-1.3`, `reasoning_effort: "minimal"`, pricing $1.25 / 1M input, $0.15 / 1M cached
input, $4.25 / 1M output (reasoning tokens are billed as output).

| Call | Latency ms | In | Cached | Out (reasoning) | Cost USD |
|---|---|---|---|---|---|
| 1a | 2396 | 15 | 0 | 59 (49) | 0.000269 |
| 1b call | 1943 | 587 | 0 | 103 (23) | 0.001172 |
| 1b final | 3353 | 721 | 497 | 80 (41) | 0.000695 |
| 1c | 2474 | 147 | 0 | 218 (148) | 0.001110 |
| 1d | 2449 | 328 | 0 | 200 (158) | 0.001260 |
| 1e | 7196 | 2533 | 0 | 74 (49) | 0.003481 |
| **Total** | | **4331** | | **734** | **~$0.0080** |

## Findings that affect the real project

- **Model id that worked:** `muse-spark-1.3` (from `GET /v1/models`; also listed: `muse-ember-1.0`,
  `muse-wonder-1.0`, `muse-spark-1.2`, `muse-spark-1.1`, contributor variants). Pinned in `.env`.
- **PDFs work inline** (`{"type":"file","file":{"filename","file_data":"data:application/pdf;base64,..."}}`),
  no render-to-image fallback needed. A 1-page PDF cost ~2.5k input tokens (pages are also
  rasterised server-side), so budget for that per evidence file. 1e was the slowest call (7.2s).
- **Tool calling:** only `tool_choice: "auto"` is supported (others return HTTP 400), so the agent
  must handle "the model answered in text instead of calling the tool".
- **Structured output** is enforced server-side with `strict: true`; we still validate with zod.
- **Cost is negligible:** one full decision with an evidence PDF is well under $0.01.
- **Dispute creation by API:** the sandbox has `POST /v1/customer/disputes`, but it needs buyer
  consent (Log in with PayPal) and a `PayPal-Auth-Assertion` JWT for the buyer. Our token
  unexpectedly has the `disputes/create` scope, so this might be scriptable later for demo
  seeding; for now disputes are filed by hand as the buyer.
- **Sandbox-only helpers exist** for demos: `POST .../adjudicate` (BUYER_FAVOR/SELLER_FAVOR) and
  `POST .../require-evidence`, both only when status is `UNDER_REVIEW`.
- **Deadline fields:** `seller_response_due_date` and `buyer_response_due_date`. Allowed actions
  come from the dispute's HATEOAS `links` plus `allowed_response_options`. (Confirm with a real
  dispute in 2e.)
- **Webhooks:** event types `CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED`. PayPal retries
  non-2xx up to 25 times over 3 days, hence de-dup. Simulator (mock) events cannot be verified via
  the postback API, per the docs.
- **Meta access from Kenya:** the Muse Spark blog says "public preview for US developers", but the
  key worked from here without issue.

## Doc discrepancies vs CLAUDE.md

- `ai.developer.meta.com/docs/models/` redirects to `dev.meta.ai/docs/models.md`;
  `developer.meta.com/ai/resources/blog/...` redirects to `dev.meta.ai/resources/blog/...`.
- `docs.paypal.ai/growth/disputes/...` redirects to `developer.paypal.com/docsai/...`.
- The Disputes list `start_time` and `next_page_token` parameters are deprecated
  (use `create_time_after` and `page`).

## Verdict

_Pending Gates 2c-2f and 3b/3e._ Gate 1 is a clear GO.
