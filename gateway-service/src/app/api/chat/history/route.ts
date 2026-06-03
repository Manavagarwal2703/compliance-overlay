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
 * GET /api/chat/history?userId=<userId>
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
 *       "role": "reviewer",
 *       "title": "Check compliance for...",
 *       "createdAt": "2024-01-15T10:30:00.000Z",
 *       "updatedAt": "2024-01-15T10:35:00.000Z"
 *     }
 *   ]
 * }
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId || userId.trim() === "") {
    return Response.json(
      { error: "userId query parameter is required" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const sessions = await prisma.session.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        userId: true,
        role: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json({ sessions }, { headers: CORS_HEADERS });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database error";
    return Response.json(
      { error: "Failed to fetch sessions", detail },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
