import { prisma } from "@/lib/prisma";
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
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...(allowedOrigin !== "*" ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
}

/**
 * GET /api/chat/history/:sessionId
 *
 * Returns all Message records for the given session, ordered chronologically.
 *
 * Response shape (session found):
 * {
 *   "sessionId": "sess_abc123",
 *   "messages": [
 *     {
 *       "id": "msg_001",
 *       "sessionId": "sess_abc123",
 *       "role": "user",
 *       "content": "Check compliance for this document.",
 *       "createdAt": "2024-01-15T10:30:00.000Z"
 *     },
 *     {
 *       "id": "msg_002",
 *       "sessionId": "sess_abc123",
 *       "role": "assistant",
 *       "content": "The document meets all compliance requirements...",
 *       "createdAt": "2024-01-15T10:30:05.000Z"
 *     }
 *   ]
 * }
 *
 * Response shape (session not found):
 * 404 { "error": "Session not found" }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  const { sessionId } = await params;

  if (!sessionId) {
    return Response.json(
      { error: "sessionId path parameter is required" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // Verify the session exists before fetching messages.
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!session) {
      return Response.json(
        { error: "Session not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const messages = await prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        sessionId: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });

    return Response.json({ sessionId, messages }, { headers: corsHeaders });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database error";
    return Response.json(
      { error: "Failed to fetch messages", detail },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * PATCH /api/chat/history/:sessionId
 *
 * Updates the title of an existing session.
 *
 * Request body:
 * { "title": "New Session Name" }
 *
 * Response — 200 OK:
 * {
 *   "id": "sess_abc123",
 *   "userId": "usr_42",
 *   "role": "user",
 *   "title": "New Session Name",
 *   "createdAt": "2026-06-07T10:30:00.000Z",
 *   "updatedAt": "2026-06-07T10:35:00.000Z"
 * }
 *
 * Error responses:
 *   400 — missing or non-string title in request body
 *   404 — no session found with the given sessionId
 *   500 — database error
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  const { sessionId } = await params;

  // ── Parse and validate request body ────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders }
    );
  }

  const title =
    body !== null &&
    typeof body === "object" &&
    "title" in body
      ? (body as Record<string, unknown>).title
      : undefined;

  if (typeof title !== "string" || title.trim() === "") {
    return Response.json(
      { error: "Request body must contain a non-empty string field: title" },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    // Verify the session exists before attempting an update.
    const existing = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });

    if (!existing) {
      return Response.json(
        { error: "Session not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: { title: title.trim() },
    });

    return Response.json(updated, { status: 200, headers: corsHeaders });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database error";
    logger.error({
      step: "db_update_session_title",
      sessionId,
      error: detail,
    });
    return Response.json(
      { error: "Failed to update session title", detail },
      { status: 500, headers: corsHeaders }
    );
  }
}
