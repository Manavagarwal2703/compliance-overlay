/** Contract A: Widget -> Gateway */

export type WidgetChatRequest = {
  sessionId: string;
  userId: string;
  role: "user" | "reviewer";
  message: string;
};

/** Contract B: Gateway -> AI Service */

export type AiChatRequest = {
  conversation_id: string;
  role: "user" | "reviewer";
  query: string;
  context_history: Array<{
    role: "user" | "reviewer" | "assistant";
    content: string;
  }>;
};

/** Contract C: SSE chunk payload */

export type SseChunkPayload = {
  type: "token" | "done" | "error";
  content?: string;
};
