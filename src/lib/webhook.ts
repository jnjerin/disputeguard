/**
 * PURPOSE
 * Verifies that a webhook really came from PayPal, using PayPal's postback API
 * (POST /v1/notifications/verify-webhook-signature). Proven in gate-check Gate 3.
 *
 * WHY THE BODY IS BUILT BY HAND
 * PayPal checks the signature against the event bytes exactly as it sent them. Parsing and
 * re-serialising the JSON can change key order or number formatting and break the check, so the
 * raw body string is embedded as-is.
 *
 * Note: events from the dashboard's Webhooks Simulator can never verify (PayPal docs); only real
 * sandbox events do.
 */
import { env } from "./env";
import { paypal, PayPalError } from "./paypal";

export type VerifyResult = { verified: boolean; status: string };

export async function verifyWebhookSignature(raw: string, headers: Headers): Promise<VerifyResult> {
  let webhookId: string;
  try {
    webhookId = env("webhook").PAYPAL_WEBHOOK_ID;
  } catch (e) {
    return { verified: false, status: `ERROR: ${(e as Error).message}` };
  }
  const h = (name: string) => JSON.stringify(headers.get(name) ?? "");
  const body =
    `{"auth_algo":${h("paypal-auth-algo")},` +
    `"cert_url":${h("paypal-cert-url")},` +
    `"transmission_id":${h("paypal-transmission-id")},` +
    `"transmission_sig":${h("paypal-transmission-sig")},` +
    `"transmission_time":${h("paypal-transmission-time")},` +
    `"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${raw}}`;
  try {
    const res = await paypal<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", body);
    return { verified: res.verification_status === "SUCCESS", status: res.verification_status };
  } catch (e) {
    return { verified: false, status: `ERROR: ${e instanceof PayPalError ? `HTTP ${e.status}` : (e as Error).message}` };
  }
}
