/** Contract A: Widget -> Gateway */

export type WidgetChatRequest = {
  sessionId: string;
  userId: string;
  message: string;
};

/** Contract B: Gateway -> AI Service */

export type AiChatRequest = {
  conversation_id: string;
  query: string;
  context_history: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
};

/** Contract C: SSE chunk payload */

export type SseChunkPayload = {
  type: "token" | "done" | "error";
  content?: string;
};
