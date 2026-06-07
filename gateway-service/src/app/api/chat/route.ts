import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { verifyJwt, extractUserId } from "@/lib/auth";
import type { AiChatRequest, SseChunkPayload, WidgetChatRequest } from "@/lib/contracts";

// ── CORS ────────────────────────────────────────────────────────────────────
//
// ALLOWED_ORIGINS is a comma-separated list of origins that are permitted to
// call this API (e.g. "http://localhost:3000,https://client-domain.com").
// When the env var is absent or empty, the wildcard "*" is used as a
// permissive fallback — acceptable for local development only.
//
const ALLOWED_ORIGINS: Set<string> = (() => {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const list = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set(list);
})();

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  // Determine the effective allowed origin for this request.
  let allowedOrigin: string;
  if (ALLOWED_ORIGINS.size === 0) {
    // No restriction configured — wildcard (dev only).
    allowedOrigin = "*";
  } else if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    allowedOrigin = requestOrigin;
  } else {
    // Origin not in allow-list — return a non-matching value so the browser
    // blocks the request. We still need to return the header so preflight
    // responses are well-formed.
    allowedOrigin = "null";
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Required when using a specific origin (not *) so browsers send cookies
    // and the Authorization header in cross-origin requests.
    ...(allowedOrigin !== "*" ? { "Access-Control-Allow-Credentials": "true" } : {}),
  };
}

// ── Auth ─────────────────────────────────────────────────────────────────────
//
// REQUIRE_AUTH=true  (production default): every POST /api/chat must carry an
//   Authorization: Bearer <JWT> header. The token is verified with HS256 using
//   JWT_SECRET and the userId is extracted from the `userId` or `sub` claim.
//   The userId in the request body is IGNORED when auth is enforced.
//
// REQUIRE_AUTH=false (local dev / bypass): no Authorization header is required.
//   The userId field from the JSON body is trusted directly, matching the
//   pre-auth behaviour. Never set this to false in production.
//
const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== "false";

// AI_SERVICE_URL must be set to the intranet IP of the machine running the
// ai-service process (e.g. http://192.168.1.50:8000/v1/chat/stream).
// Do NOT use localhost unless the gateway and ai-service are on the same server.
// If this variable is missing the route returns 503 immediately rather than
// trying to reach a wrong host and producing a misleading 502.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL;

// ENABLE_AI_MEMORY controls whether past messages are fetched from Postgres and
// injected into the Contract B payload as context_history. When false, an empty
// array is sent and the AI has no memory of prior turns. This flag does NOT
// affect the GET /api/chat/history endpoints — those always read from the DB so
// the UI sidebar continues to work regardless of this setting.
const ENABLE_AI_MEMORY = process.env.ENABLE_AI_MEMORY === "true";

// Number of conversation turns (user + assistant pairs) to include in
// context_history when memory is enabled. Each turn = 2 messages, so 5 turns
// = up to 10 messages fetched. Kept low to avoid hitting token limits.
const MEMORY_TURNS = 5;

function parseSseDataLine(line: string): SseChunkPayload | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }
  const jsonPart = trimmed.slice(5).trim();
  if (!jsonPart) {
    return null;
  }
  try {
    return JSON.parse(jsonPart) as SseChunkPayload;
  } catch {
    return null;
  }
}

/** Generates a session title from the first user message (max 30 chars + "..."). */
function deriveTitle(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 30) return trimmed;
  return `${trimmed.slice(0, 30)}...`;
}

/** Generates a unique ID (used for new Message rows when the caller omits one). */
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function OPTIONS(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const corsHeaders = buildCorsHeaders(origin);

  // ── 1. Auth — JWT verification or dev-mode bypass ─────────────────────────
  //
  // When REQUIRE_AUTH=true the Authorization header is mandatory. The userId
  // is extracted from the verified JWT payload so the body-supplied value
  // cannot be spoofed. When REQUIRE_AUTH=false we fall back to the userId
  // in the request body (dev / testing mode only).
  //
  let authenticatedUserId: string | null = null;

  if (REQUIRE_AUTH) {
    const authHeader = request.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return Response.json(
        { error: "Unauthorized: missing or malformed Authorization header" },
        { status: 401, headers: corsHeaders }
      );
    }
    const token = authHeader.slice(7).trim();
    try {
      const payload = verifyJwt(token);
      authenticatedUserId = extractUserId(payload);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Invalid token";
      logger.warn({ step: "auth_verify", error: detail });
      return Response.json(
        { error: "Unauthorized", detail },
        { status: 401, headers: corsHeaders }
      );
    }
  }

  // ── 2. Parse and validate request body ────────────────────────────────────
  let body: WidgetChatRequest;
  try {
    body = (await request.json()) as WidgetChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const { sessionId, role, message } = body;
  // In auth mode userId comes from the JWT; in dev mode it comes from the body.
  const userId: string = REQUIRE_AUTH
    ? (authenticatedUserId as string)
    : (body.userId ?? "");

  if (!sessionId || !userId || !role || !message) {
    return Response.json(
      { error: "sessionId, userId, role, and message are required" },
      { status: 400, headers: corsHeaders }
    );
  }

  // ── 2. Upsert session and save the incoming user message ──────────────────
  try {
    await prisma.session.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        userId,
        role,
        title: deriveTitle(message),
      },
      update: {
        // If session already exists do not overwrite title/role
        updatedAt: new Date(),
      },
    });

    await prisma.message.create({
      data: {
        id: generateId("msg"),
        sessionId,
        role: "user",
        content: message,
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database error";
    logger.error({
      step: "db_upsert",
      sessionId,
      error: detail,
    });
    return Response.json(
      { error: "Failed to persist message", detail },
      { status: 500, headers: corsHeaders }
    );
  }

  // ── 3. Build AI service payload (Contract B) ───────────────────────────────
  //
  // context_history shape: [{ role: "user" | "assistant", content: string }]
  //
  // When ENABLE_AI_MEMORY is true we load the last MEMORY_TURNS conversation
  // turns (user + assistant pairs) from Postgres. The newly saved user message
  // is excluded because the AI receives it as the `query` field separately.
  //
  // When ENABLE_AI_MEMORY is false we send an empty array, meaning the AI
  // service treats every request as a fresh conversation. The history endpoints
  // are unaffected — the UI sidebar always reads from the database.
  //
  let contextHistory: AiChatRequest["context_history"] = [];

  if (ENABLE_AI_MEMORY) {
    try {
      // Fetch the most recent messages for this session (excluding the message
      // we just saved, which is the current user turn).
      const recentMessages = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        // Fetch MEMORY_TURNS * 2 messages (each turn = 1 user + 1 assistant),
        // plus 1 extra to account for the user message we just inserted.
        take: MEMORY_TURNS * 2 + 1,
        select: { role: true, content: true, createdAt: true },
      });

      // The most recently inserted row is the current user message — drop it
      // so it is not duplicated in context_history.
      const history = recentMessages.slice(1);

      // Reverse to restore chronological order (oldest → newest).
      contextHistory = history.reverse().map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    } catch (err) {
      // Non-fatal: fall back to empty context so the request still proceeds.
      logger.warn({
        step: "memory_fetch",
        sessionId,
        error: err instanceof Error ? err.message : "Failed to fetch context history",
      });
      contextHistory = [];
    }
  }

  const aiPayload: AiChatRequest = {
    conversation_id: sessionId,
    role,
    query: message,
    context_history: contextHistory,
  };

  // ── 4. Call AI service ─────────────────────────────────────────────────────
  if (!AI_SERVICE_URL) {
    return Response.json(
      { error: "AI_SERVICE_URL is not configured. Set it in gateway-service/.env." },
      { status: 503, headers: corsHeaders }
    );
  }

  let aiResponse: Response;
  try {
    aiResponse = await fetch(AI_SERVICE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(aiPayload),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "AI service unreachable";
    logger.error({
      step: "ai_fetch",
      sessionId,
      error: detail,
    });
    return Response.json({ error: detail }, { status: 502, headers: corsHeaders });
  }

  if (!aiResponse.ok || !aiResponse.body) {
    const text = await aiResponse.text().catch(() => "");
    logger.error({
      step: "ai_response",
      sessionId,
      error: `AI service returned ${aiResponse.status}`,
      aiDetail: text,
    });
    return Response.json(
      { error: "AI service error", detail: text },
      { status: aiResponse.status || 502, headers: corsHeaders }
    );
  }

  // ── 5. Pipe the SSE stream through a TransformStream ──────────────────────
  //
  // The TransformStream forwards every raw byte to the client immediately
  // (zero transformation) while the pump() task accumulates token payloads
  // in memory. When the upstream stream ends, flush() persists the full
  // assembled assistant reply as a single Message row.
  //
  const reader = aiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembledAssistantText = "";

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
    flush: async () => {
      // Persist the fully assembled assistant message after the stream ends.
      if (assembledAssistantText.trim()) {
        try {
          await prisma.message.create({
            data: {
              id: generateId("msg"),
              sessionId,
              role: "assistant",
              content: assembledAssistantText.trim(),
            },
          });
        } catch (err) {
          // Non-fatal: the stream has already been delivered to the client.
          // Log and continue — the session is still usable.
          logger.error({
            step: "db_persist_assistant",
            sessionId,
            error: err instanceof Error ? err.message : "Failed to persist assistant message",
          });
        }
      }
    },
  });

  const writer = writable.getWriter();

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Forward raw bytes to the client immediately.
        await writer.write(value);

        // Parse SSE tokens in parallel to assemble the full response.
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const parsed = parseSseDataLine(line);
          if (parsed?.type === "token" && parsed.content) {
            assembledAssistantText += parsed.content;
          }
        }
      }

      // Flush any remaining buffered text after the last newline.
      if (buffer.trim()) {
        const parsed = parseSseDataLine(buffer);
        if (parsed?.type === "token" && parsed.content) {
          assembledAssistantText += parsed.content;
        }
      }
    } catch {
      // Upstream closed unexpectedly — the client already got what was sent.
    } finally {
      // Closing the writer triggers the TransformStream flush() above.
      await writer.close();
    }
  };

  void pump();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
