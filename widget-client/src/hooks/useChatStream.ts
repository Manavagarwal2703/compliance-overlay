import { useCallback } from "react";
import { useChatStore } from "../store/useChatStore";

type SsePayload = {
  type: "token" | "done" | "error";
  content?: string;
};

function parseSseLine(line: string): SsePayload | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }
  const jsonPart = trimmed.slice(5).trim();
  if (!jsonPart) {
    return null;
  }
  try {
    return JSON.parse(jsonPart) as SsePayload;
  } catch {
    return null;
  }
}

export function useChatStream() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const userId = useChatStore((s) => s.userId);
  const userRole = useChatStore((s) => s.userRole);
  const gatewayUrl = useChatStore((s) => s.gatewayUrl);
  const authToken = useChatStore((s) => s.authToken);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const startAssistantMessage = useChatStore((s) => s.startAssistantMessage);
  const appendStreamToken = useChatStore((s) => s.appendStreamToken);
  const finishStream = useChatStore((s) => s.finishStream);
  const setError = useChatStore((s) => s.setError);
  const setStreaming = useChatStore((s) => s.setStreaming);

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || isStreaming) {
        return;
      }

      setError(null);
      addUserMessage(trimmed);
      startAssistantMessage();
      setStreaming(true);

      try {
        // Build request headers — attach the auth token only when present.
        const requestHeaders: HeadersInit = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        };
        if (authToken) {
          (requestHeaders as Record<string, string>)["Authorization"] = `Bearer ${authToken}`;
        }

        const response = await fetch(gatewayUrl, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            sessionId: activeSessionId,
            userId,
            role: userRole,
            message: trimmed,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          throw new Error(errBody || `Gateway error ${response.status}`);
        }

        if (!response.body) {
          throw new Error("No response stream from gateway");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const parsed = parseSseLine(line);
            if (!parsed) {
              continue;
            }
            if (parsed.type === "token" && parsed.content) {
              appendStreamToken(parsed.content);
            }
            if (parsed.type === "done") {
              finishStream();
            }
            if (parsed.type === "error") {
              throw new Error(parsed.content ?? "Stream error");
            }
          }
        }

        if (buffer.trim()) {
          const parsed = parseSseLine(buffer);
          if (parsed?.type === "token" && parsed.content) {
            appendStreamToken(parsed.content);
          }
        }

        finishStream();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to send message";
        setError(msg);
        finishStream();
      }
    },
    [
      activeSessionId,
      userId,
      userRole,
      gatewayUrl,
      authToken,
      isStreaming,
      addUserMessage,
      startAssistantMessage,
      appendStreamToken,
      finishStream,
      setError,
      setStreaming,
    ]
  );

  return { sendMessage, isStreaming };
}
