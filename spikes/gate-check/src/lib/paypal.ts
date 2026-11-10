/**
 * PURPOSE
 * A tiny PayPal REST client built on plain `fetch` (no PayPal SDK on purpose, so we can see the
 * raw HTTP behaviour). Gate 2 (Disputes + Orders) and Gate 3 (webhook signature verification)
 * both use it.
 *
 * HOW PAYPAL AUTH WORKS (https://developer.paypal.com/api/rest/authentication/)
 * 1. We POST our app's client id + secret (as HTTP Basic auth) to /v1/oauth2/token with
 *    grant_type=client_credentials.
 * 2. PayPal answers with a short-lived `access_token` (lasts `expires_in` seconds).
 * 3. Every other call sends that token as `Authorization: Bearer <token>`.
 *
 * SAFETY
 * - loadEnv("paypal") refuses to run unless PAYPAL_BASE_URL is the sandbox host, so this client
 *   can never reach live PayPal.
 * - Secrets and tokens are never printed. Error messages include PayPal's error body, which
 *   contains error names and debug ids, not credentials.
 */
import { loadEnv } from "./env.js";

const env = loadEnv("paypal");

/** Thrown for any non-2xx answer. Keeps the status code so callers can explain 401 vs 403 etc. */
export class PayPalError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(`HTTP ${status} on ${path}: ${body.slice(0, 800)}`);
  }
}

// The token is cached in memory and reused until 60 seconds before it expires.
let cached: { token: string; expiresAt: number; scope: string } | undefined;

/** Step 2a: get (or reuse) an OAuth2 access token using the client-credentials grant. */
export async function getToken(): Promise<{ token: string; scope: string }> {
  if (cached && Date.now() < cached.expiresAt) return cached;
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const text = await res.text();
  if (!res.ok) throw new PayPalError(res.status, "/v1/oauth2/token", text);
  const json = JSON.parse(text) as { access_token: string; expires_in: number; scope: string };
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000, scope: json.scope };
  return cached;
}

/**
 * Calls any PayPal REST endpoint with a Bearer token and returns the parsed JSON body.
 * `body` objects are sent as JSON. Pass a FormData for multipart endpoints (e.g. provide-evidence).
 * Pass a string to send pre-built JSON byte-for-byte (webhook verification needs the event
 * exactly as received; re-serializing it can break the signature check).
 * Some endpoints answer 204 No Content, in which case this returns null.
 */
export async function paypal<T = any>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const { token } = await getToken();
  const isForm = body instanceof FormData;
  const res = await fetch(`${env.PAYPAL_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      // For FormData, fetch sets the multipart Content-Type (with boundary) by itself.
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : isForm || typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new PayPalError(res.status, path, text);
  return (text ? JSON.parse(text) : null) as T;
}

export const PAYPAL_BASE_URL = env.PAYPAL_BASE_URL;
