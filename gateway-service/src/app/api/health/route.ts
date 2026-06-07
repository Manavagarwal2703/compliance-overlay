import { logger } from "@/lib/logger";

// ── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS: Set<string> = (() => {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const list = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set(list);
})();

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  let allowedOrigin: string;
  if (ALLOWED_ORIGINS.size === 0) {
    allowedOrigin = "*";
  } else if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    allowedOrigin = requestOrigin;
  } else {
    allowedOrigin = "null";
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...(allowedOrigin !== "*" ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}

const AI_SERVICE_URL = process.env.AI_SERVICE_URL;
const HEALTH_TIMEOUT_MS = 5_000;

function getAiHealthUrl(): string | null {
  if (!AI_SERVICE_URL) return null;
  try {
    const parsed = new URL(AI_SERVICE_URL);
    return `${parsed.origin}/health`;
  } catch {
    return null;
  }
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
}

/**
 * GET /api/health
 *
 * Proxies a liveness check to the AI service. Returns 200 when the upstream
 * /health endpoint responds OK; 503 when unreachable, misconfigured, or timed out.
 */
export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  const healthUrl = getAiHealthUrl();
  if (!healthUrl) {
    return Response.json(
      { status: "error", ai: "offline" },
      { status: 503, headers: corsHeaders }
    );
  }

  try {
    const aiResponse = await fetch(healthUrl, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });

    if (aiResponse.ok) {
      return Response.json(
        { status: "ok", ai: "online" },
        { status: 200, headers: corsHeaders }
      );
    }

    logger.warn({
      step: "ai_health_probe",
      error: `AI service returned ${aiResponse.status}`,
      healthUrl,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "AI health probe failed";
    logger.warn({ step: "ai_health_probe", error: detail, healthUrl });
  }

  return Response.json(
    { status: "error", ai: "offline" },
    { status: 503, headers: corsHeaders }
  );
}
