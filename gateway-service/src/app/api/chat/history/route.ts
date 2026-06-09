import { prisma } from "@/lib/prisma";
import { verifyJwt, extractUserId, extractToken } from "@/lib/auth";



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
  };
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
}

/**
 * GET /api/chat/history
 *
 * Returns all Session records for the given userId, ordered by most recently
 * updated first.
 *
 * Response shape:
 * {
 *   "sessions": [
 *     {
 *       "id": "sess_abc123",
 *       "userId": "user_42",
 *       "title": "Check compliance for...",
 *       "createdAt": "2024-01-15T10:30:00.000Z",
 *       "updatedAt": "2024-01-15T10:35:00.000Z"
 *     }
 *   ]
 * }
 */
export async function GET(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  const token = extractToken(request);
  if (!token) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  let userId: string;
  try {
    const payload = verifyJwt(token);
    userId = extractUserId(payload);
  } catch (err) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: corsHeaders }
    );
  }

  try {
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        userId: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json({ sessions }, { headers: corsHeaders });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database error";
    return Response.json(
      { error: "Failed to fetch sessions", detail },
      { status: 500, headers: corsHeaders }
    );
  }
}
