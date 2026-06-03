import { create } from "zustand";

export type ChatRole = "user" | "reviewer";

export type ChatMessage = {
  id: string;
  role: ChatRole | "assistant";
  content: string;
  isStreaming?: boolean;
};

type ChatState = {
  isOpen: boolean;
  activeRole: ChatRole;
  sessionId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  gatewayUrl: string;
  setGatewayUrl: (url: string) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setActiveRole: (role: ChatRole) => void;
  addUserMessage: (content: string) => string;
  startAssistantMessage: () => string;
  appendStreamToken: (token: string) => void;
  finishStream: () => void;
  setError: (error: string | null) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
};

function generateId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  activeRole: "user",
  sessionId: generateSessionId(),
  messages: [],
  isStreaming: false,
  error: null,
  gatewayUrl: "http://localhost:3000/api/chat",

  setGatewayUrl: (url) => set({ gatewayUrl: url }),

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setOpen: (open) => set({ isOpen: open }),

  setActiveRole: (role) => set({ activeRole: role }),

  addUserMessage: (content) => {
    const id = generateId();
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: s.activeRole, content },
      ],
    }));
    return id;
  },

  startAssistantMessage: () => {
    const id = generateId();
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: "assistant", content: "", isStreaming: true },
      ],
    }));
    return id;
  },

  appendStreamToken: (token) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") {
        return s;
      }
      messages[messages.length - 1] = {
        ...last,
        content: last.content + token,
        isStreaming: true,
      };
      return { messages };
    });
  },

  finishStream: () => {
    set((s) => {
      const messages = s.messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m
      );
      return { messages, isStreaming: false };
    });
  },

  setError: (error) => set({ error }),

  setStreaming: (isStreaming) => set({ isStreaming }),

  clearMessages: () => set({ messages: [], sessionId: generateSessionId() }),
}));
