import { useCallback } from "react";
import { useChatStore } from "../store/useChatStore";
import { formatApiError } from "../utils/apiError";
import { extractUserIdFromJwt } from "../utils/jwt";

type SsePayload = {
  type: "token" | "done" | "error" | "sources";
  content?: string | string[];
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

  const gatewayUrl = useChatStore((s) => s.gatewayUrl);
  const authToken = useChatStore((s) => s.authToken);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const startAssistantMessage = useChatStore((s) => s.startAssistantMessage);
  const appendStreamToken = useChatStore((s) => s.appendStreamToken);
  const setStreamSources = useChatStore((s) => s.setStreamSources);
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

        const dynamicUserId = authToken ? extractUserIdFromJwt(authToken) : null;

        const response = await fetch(gatewayUrl, {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({
            sessionId: activeSessionId,
            userId: dynamicUserId || "dev_user_001",
            message: trimmed,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => "");
          throw new Error(formatApiError(response.status, errBody));
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
            if (parsed.type === "token" && typeof parsed.content === "string" && parsed.content) {
              appendStreamToken(parsed.content);
            }
            if (parsed.type === "sources" && Array.isArray(parsed.content)) {
              setStreamSources(parsed.content as string[]);
            }
            if (parsed.type === "done") {
              finishStream();
            }
            if (parsed.type === "error") {
              const errContent =
                typeof parsed.content === "string" ? parsed.content : "Stream error";
              if (/unauthorized/i.test(errContent)) {
                throw new Error("Authentication failed. Please check your session.");
              }
              throw new Error(errContent);
            }
          }
        }

        if (buffer.trim()) {
          const parsed = parseSseLine(buffer);
          if (parsed?.type === "token" && typeof parsed.content === "string" && parsed.content) {
            appendStreamToken(parsed.content);
          }
        }

        finishStream();
      } catch (err) {
        let msg = err instanceof Error ? err.message : "Failed to send message";
        if (/^\s*\{/.test(msg)) {
          try {
            const parsed = JSON.parse(msg) as { error?: unknown };
            if (typeof parsed.error === "string") {
              msg = /unauthorized/i.test(parsed.error)
                ? "Authentication failed. Please check your session."
                : parsed.error;
            }
          } catch {
            // keep original message
          }
        }
        setError(msg);
        finishStream();
      }
    },
    [
      activeSessionId,

      gatewayUrl,
      authToken,
      isStreaming,
      addUserMessage,
      startAssistantMessage,
      appendStreamToken,
      setStreamSources,
      finishStream,
      setError,
      setStreaming,
    ]
  );

  return { sendMessage, isStreaming };
}
