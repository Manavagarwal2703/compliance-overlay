import { prisma } from "@/lib/prisma";
import type { AiChatRequest, SseChunkPayload, WidgetChatRequest } from "@/lib/contracts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// AI_SERVICE_URL must be set to the intranet IP of the machine running the
// ai-service process (e.g. http://192.168.1.50:8000/v1/chat/stream).
// Do NOT use localhost unless the gateway and ai-service are on the same server.
// If this variable is missing the route returns 503 immediately rather than
// trying to reach a wrong host and producing a misleading 502.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL;

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

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  // ── 1. Parse and validate request body ────────────────────────────────────
  let body: WidgetChatRequest;
  try {
    body = (await request.json()) as WidgetChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, userId, role, message } = body;
  if (!sessionId || !userId || !role || !message) {
    return Response.json(
      { error: "sessionId, userId, role, and message are required" },
      { status: 400 }
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
    return Response.json({ error: "Failed to persist message", detail }, { status: 500 });
  }

  // ── 3. Build AI service payload (Contract B) ───────────────────────────────
  const aiPayload: AiChatRequest = {
    conversation_id: sessionId,
    role,
    query: message,
    context_history: [],
  };

  // ── 4. Call AI service ─────────────────────────────────────────────────────
  if (!AI_SERVICE_URL) {
    return Response.json(
      { error: "AI_SERVICE_URL is not configured. Set it in gateway-service/.env." },
      { status: 503 }
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
    return Response.json({ error: detail }, { status: 502 });
  }

  if (!aiResponse.ok || !aiResponse.body) {
    const text = await aiResponse.text().catch(() => "");
    return Response.json(
      { error: "AI service error", detail: text },
      { status: aiResponse.status || 502 }
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
        } catch {
          // Non-fatal: the stream has already been delivered to the client.
          // Log and continue — the session is still usable.
          console.error("[gateway] Failed to persist assistant message for session", sessionId);
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
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
