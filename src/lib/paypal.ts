/**
 * PURPOSE
 * A small PayPal REST client on plain `fetch` (no PayPal SDK), moved from the gate-check spike
 * where it was proven against the sandbox. Used for the Disputes API, Orders v2 (test data) and
 * webhook signature verification.
 *
 * HOW PAYPAL AUTH WORKS (https://developer.paypal.com/api/rest/authentication/)
 * 1. POST client id + secret (HTTP Basic) to /v1/oauth2/token with grant_type=client_credentials.
 * 2. PayPal returns a short-lived `access_token`; we cache it until 60 s before it expires.
 * 3. Every other call sends `Authorization: Bearer <token>`.
 *
 * SAFETY
 * - env("paypal") only accepts the sandbox host, so this client cannot reach live PayPal.
 * - Tokens and secrets are never logged. Errors carry PayPal's error body (error names and
 *   debug ids, no credentials).
 * - This module only *performs* calls. The rule "no write without a human click" is enforced by
 *   the callers: write actions live in server actions triggered from buttons, never in the agent.
 */
import { env } from "./env";

/** Thrown for any non-2xx answer. Keeps the status so the UI can explain 401 vs 422 etc. */
export class PayPalError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(`PayPal HTTP ${status} on ${path}: ${body.slice(0, 800)}`);
  }
}

let cached: { token: string; expiresAt: number } | undefined;

/** Gets (or reuses) an OAuth2 access token with the client-credentials grant. */
export async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const e = env("paypal");
  const basic = Buffer.from(`${e.PAYPAL_CLIENT_ID}:${e.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${e.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new PayPalError(res.status, "/v1/oauth2/token", text);
  const json = JSON.parse(text) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return cached.token;
}

/**
 * Calls any PayPal REST endpoint and returns the parsed JSON (or null for 204 No Content).
 * - Plain objects are sent as JSON.
 * - FormData is sent as multipart (provide-evidence needs this); fetch sets the boundary.
 * - Strings are sent byte-for-byte (webhook verification needs the event exactly as received).
 */
export async function paypal<T = unknown>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const token = await getToken();
  const isForm = body instanceof FormData;
  const res = await fetch(`${env("paypal").PAYPAL_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : isForm || typeof body === "string" ? body : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new PayPalError(res.status, path, text);
  return (text ? JSON.parse(text) : null) as T;
}
