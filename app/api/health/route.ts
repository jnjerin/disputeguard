/**
 * PURPOSE
 * GET /api/health: liveness check for Render. Does not touch PayPal, Meta or the database,
 * so a slow dependency never makes Render restart a healthy app.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "disputeguard" });
}
