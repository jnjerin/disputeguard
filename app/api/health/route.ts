/**
 * PURPOSE
 * GET /api/health: liveness check for Render. Does not touch PayPal, Meta or the database,
 * so a slow dependency never makes Render restart a healthy app.
 *
 * GET /api/health?meta=1: deployment diagnostic for the Meta Model API. Reports which base URL
 * and model id the server is configured with, the key's length (never the key itself), and the
 * model ids this key can see (GET /v1/models). Used to debug "model_not_found" on the host.
 */
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("meta") !== "1") {
    return Response.json({ ok: true, service: "disputeguard" });
  }
  try {
    const e = env("meta");
    const rawModel = process.env.META_MODEL ?? null; // untrimmed, to spot stray whitespace
    const res = await fetch(`${e.META_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${e.MODEL_API_KEY}` },
    });
    const body = await res.text();
    let models: unknown = body.slice(0, 500);
    try {
      models = (JSON.parse(body).data ?? []).map((m: { id: string }) => m.id);
    } catch {}
    return Response.json({
      baseUrl: e.META_BASE_URL,
      model: e.META_MODEL,
      rawModelJson: JSON.stringify(rawModel),
      keyLength: e.MODEL_API_KEY.length,
      rawKeyLength: process.env.MODEL_API_KEY?.length ?? null,
      modelsStatus: res.status,
      models,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
