import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "reviewer";

export type ChatMessage = {
  id: string;
  role: ChatRole | "assistant";
  content: string;
  isStreaming?: boolean;
};

/**
 * A lightweight record representing a single conversation session.
 * `messages` are stored separately in the active message list; past sessions
 * only carry metadata here (title + date). A real API layer would hydrate the
 * messages on session selection — the UI/state shape is wired up and ready.
 */
export type ChatSession = {
  id: string;
  title: string;
  date: string; // ISO date string, e.g. "2026-06-03"
};

type ChatState = {
  // ── Identity (injected by host via HTML attributes) ──────────────────────
  userId: string;
  userRole: ChatRole;

  // ── Widget visibility ─────────────────────────────────────────────────────
  isOpen: boolean;

  // ── Active conversation ───────────────────────────────────────────────────
  activeSessionId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;

  // ── Session history (sidebar) ─────────────────────────────────────────────
  sessions: ChatSession[];
  isSidebarOpen: boolean;

  // ── Gateway ───────────────────────────────────────────────────────────────
  gatewayUrl: string;

  // ── Actions ───────────────────────────────────────────────────────────────
  /** Called once by the Web Component after reading HTML attributes. */
  initUser: (userId: string, userRole: ChatRole) => void;

  setGatewayUrl: (url: string) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  /** Clear messages and start a fresh session; archives the previous one. */
  newSession: () => void;

  /** Switch the active session (UI only — messages are not loaded here). */
  setActiveSession: (sessionId: string) => void;

  addUserMessage: (content: string) => string;
  startAssistantMessage: () => string;
  appendStreamToken: (token: string) => void;
  finishStream: () => void;
  setError: (error: string | null) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Seed with a handful of realistic-looking mock sessions for the sidebar. */
function buildMockSessions(): ChatSession[] {
  const now = Date.now();
  const day = 86_400_000;
  return [
    {
      id: generateSessionId(),
      title: "Q2 Audit Compliance Check",
      date: new Date(now - day).toISOString().slice(0, 10),
    },
    {
      id: generateSessionId(),
      title: "GDPR Data Retention Policy",
      date: new Date(now - 2 * day).toISOString().slice(0, 10),
    },
    {
      id: generateSessionId(),
      title: "Vendor Risk Assessment — Acme Corp",
      date: new Date(now - 5 * day).toISOString().slice(0, 10),
    },
    {
      id: generateSessionId(),
      title: "ISO 27001 Gap Analysis",
      date: new Date(now - 8 * day).toISOString().slice(0, 10),
    },
  ];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialSessionId = generateSessionId();

export const useChatStore = create<ChatState>((set, get) => ({
  // ── Identity ──────────────────────────────────────────────────────────────
  userId: "",
  userRole: "user",

  // ── Widget visibility ─────────────────────────────────────────────────────
  isOpen: false,

  // ── Active conversation ───────────────────────────────────────────────────
  activeSessionId: initialSessionId,
  messages: [],
  isStreaming: false,
  error: null,

  // ── Session history ───────────────────────────────────────────────────────
  sessions: buildMockSessions(),
  isSidebarOpen: false,

  // ── Gateway ───────────────────────────────────────────────────────────────
  gatewayUrl: "http://localhost:3000/api/chat",

  // ── Actions ───────────────────────────────────────────────────────────────

  initUser: (userId, userRole) => set({ userId, userRole }),

  setGatewayUrl: (url) => set({ gatewayUrl: url }),

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setOpen: (open) => set({ isOpen: open }),

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  newSession: () => {
    const { messages, activeSessionId, sessions } = get();

    // Archive current session into history if it had any messages
    let updatedSessions = sessions;
    if (messages.length > 0) {
      const firstUserMsg = messages.find((m) => m.role !== "assistant");
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 48) +
          (firstUserMsg.content.length > 48 ? "…" : "")
        : `Session ${activeSessionId.slice(-6)}`;

      const archived: ChatSession = {
        id: activeSessionId,
        title,
        date: todayIso(),
      };
      // Prepend to sessions so newest is on top
      updatedSessions = [archived, ...sessions];
    }

    set({
      activeSessionId: generateSessionId(),
      messages: [],
      error: null,
      isStreaming: false,
      sessions: updatedSessions,
      isSidebarOpen: false,
    });
  },

  setActiveSession: (sessionId) => {
    set({
      activeSessionId: sessionId,
      // Messages for past sessions would be fetched from the API here.
      // For now we clear and show a placeholder — API integration ready.
      messages: [],
      error: null,
      isSidebarOpen: false,
    });
  },

  addUserMessage: (content) => {
    const id = generateId();
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: s.userRole, content },
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

  clearMessages: () =>
    set({ messages: [], activeSessionId: generateSessionId() }),
}));
