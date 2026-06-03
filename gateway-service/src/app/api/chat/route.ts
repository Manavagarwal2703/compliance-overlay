import { saveMessage } from "@/lib/db/schema";
import type { AiChatRequest, SseChunkPayload, WidgetChatRequest } from "@/lib/contracts";

export const runtime = "edge";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL ?? "http://localhost:8000/v1/chat/stream";

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

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  let body: WidgetChatRequest;
  try {
    body = (await request.json()) as WidgetChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, role, message } = body;
  if (!sessionId || !role || !message) {
    return Response.json(
      { error: "sessionId, role, and message are required" },
      { status: 400 }
    );
  }

  await saveMessage("", sessionId, role, message);

  const aiPayload: AiChatRequest = {
    conversation_id: sessionId,
    role,
    query: message,
    context_history: [],
  };

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

  const reader = aiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assembledAssistantText = "";

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        await writer.write(value);

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

      if (buffer.trim()) {
        const parsed = parseSseDataLine(buffer);
        if (parsed?.type === "token" && parsed.content) {
          assembledAssistantText += parsed.content;
        }
      }

      if (assembledAssistantText.trim()) {
        await saveMessage("", sessionId, "assistant", assembledAssistantText);
      }
    } catch {
      // stream already closed to client
    } finally {
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
