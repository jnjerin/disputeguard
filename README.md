# DisputeGuard (working name)

An AI agent for PayPal disputes. It receives a dispute webhook, reads the evidence with Meta's
Muse Spark model, recommends fight or settle, drafts a response, and acts through the PayPal
Disputes API only after a human approves.

## Status

Gate-check spike: proving the Meta Model API, PayPal sandbox Disputes API and webhooks all work
before building the product. See `spikes/gate-check/`.

```bash
cp .env.example .env   # fill in sandbox credentials
npm install
npm run gate1          # Meta Model API
npm run gate2          # PayPal sandbox + Disputes API
npm run gate3          # webhook receiver
```

Sandbox only. This repo never touches live PayPal.

## License

MIT
