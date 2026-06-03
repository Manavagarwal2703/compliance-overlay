import { prisma } from "@/lib/prisma";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
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
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const { sessionId } = await params;

  if (!sessionId) {
    return Response.json(
      { error: "sessionId path parameter is required" },
      { status: 400, headers: CORS_HEADERS }
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
        { status: 404, headers: CORS_HEADERS }
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

    return Response.json({ sessionId, messages }, { headers: CORS_HEADERS });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database error";
    return Response.json(
      { error: "Failed to fetch messages", detail },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
