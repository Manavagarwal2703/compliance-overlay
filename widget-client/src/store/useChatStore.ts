import { create } from "zustand";
import { extractUserNameFromJwt } from "../utils/jwt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "reviewer";

export type ChatMessage = {
  id: string;
  role: ChatRole | "assistant";
  content: string;
  isStreaming?: boolean;
  /** RAG citation filenames attached via the Contract C `sources` SSE event. */
  sources?: string[];
  timestamp?: string;
};

/**
 * A lightweight record representing a single conversation session.
 * `messages` are stored separately in the active message list; past sessions
 * only carry metadata here (title + date). A real API layer would hydrate the
 * messages on session selection — the UI/state shape is wired up and ready.
 */
export type ChatSession = {
  id: string;
  /** Custom title set by the user via inline rename, or null if not yet named. */
  title: string | null;
  /** ISO date string used for sidebar date grouping, e.g. "2026-06-03". */
  date: string;
  /** Full ISO timestamp of last activity — used for precise group bucketing. */
  updatedAt: string;
};

export type SystemStatus = "connecting" | "online" | "offline" | "unauthorized";

type ChatState = {
  // ── Identity (injected by host via HTML attributes) ──────────────────────
  userId: string;
  userRole: ChatRole;
  /** Display name extracted from JWT payload (name, userName, userId, or sub). */
  userName: string | null;

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
  /** Aggregated gateway + AI availability; drives header dot and input lock. */
  systemStatus: SystemStatus;

  // ── Gateway ─────────────────────────────────────────────────────────────────
  gatewayUrl: string;

  // ── Auth ──────────────────────────────────────────────────────────────────────
  /**
   * Optional JWT Bearer token injected from the `auth-token` HTML attribute.
   * When set, useChatStream attaches it as `Authorization: Bearer <token>` on
   * every Contract A request. When null, the header is omitted entirely.
   */
  authToken: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  /** Called once by the Web Component after reading HTML attributes. */
  initUser: (userId: string, userRole: ChatRole) => void;

  setGatewayUrl: (url: string) => void;
  /** Update the auth token from the auth-token HTML attribute. */
  setAuthToken: (token: string | null) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  /** Clear messages and start a fresh session (no sidebar entry until first message). */
  newSession: () => void;

  /** Switch the active session (UI only — messages are not loaded here). */
  setActiveSession: (sessionId: string) => void;

  /** Fetch message history for a session and replace the active messages. */
  loadSession: (sessionId: string) => Promise<void>;

  /** Alias for loadSession — fetches messages for a session with auth + userId. */
  fetchSessionMessages: (sessionId: string) => Promise<void>;

  /** Fetch the list of sessions for a user and populate the sidebar. */
  loadSessions: (userId: string) => Promise<void>;

  /** Fetch history for the current user (reads userId from store). */
  fetchHistory: () => Promise<void>;

  /**
   * Dual health check on mount: verifies DB (history) and AI service (/api/health).
   * Sets systemStatus and hydrates the session sidebar when both probes succeed.
   */
  initializeSystem: () => Promise<void>;

  /**
   * PATCH /api/chat/history/[sessionId] with the new title.
   * Optimistically updates the local `sessions` array so the UI reflects the
   * change instantly; rolls back on network failure.
   */
  renameSession: (sessionId: string, newTitle: string) => Promise<void>;

  addUserMessage: (content: string) => string;
  startAssistantMessage: () => string;
  appendStreamToken: (token: string) => void;
  /** Attach RAG citation sources to the currently-streaming assistant message. */
  setStreamSources: (sources: string[]) => void;
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

function resolveUserId(userId: string): string {
  return userId || "dev_user_001";
}

function getGatewayBase(gatewayUrl: string): string {
  const stripped = gatewayUrl.replace(/\/api\/chat\/?$/, "");
  if (stripped) return stripped;
  return import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:3000";
}

function buildAuthHeaders(authToken: string | null): HeadersInit {
  if (!authToken) return {};
  return { Authorization: `Bearer ${authToken}` };
}

/** Derive a sidebar title from the first user message (only when title is null). */
function titleFromFirstMessage(content: string): string {
  return (
    content.slice(0, 48) + (content.length > 48 ? "…" : "")
  );
}

/** Upsert the active session into the sidebar list after a user sends a message. */
function upsertSessionOnMessage(
  sessions: ChatSession[],
  sessionId: string,
  messageContent: string
): ChatSession[] {
  const now = new Date().toISOString();
  const date = now.slice(0, 10);
  const existing = sessions.find((s) => s.id === sessionId);

  if (existing) {
    const updated: ChatSession = {
      ...existing,
      date,
      updatedAt: now,
    };
    return [updated, ...sessions.filter((s) => s.id !== sessionId)];
  }

  // New session — title is null, so apply the first-message fallback once.
  const created: ChatSession = {
    id: sessionId,
    title: titleFromFirstMessage(messageContent),
    date,
    updatedAt: now,
  };

  return [created, ...sessions];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialSessionId = generateSessionId();

export const useChatStore = create<ChatState>((set, get) => ({
  // ── Identity ──────────────────────────────────────────────────────────────
  userId: "",
  userRole: "user",
  userName: null,

  // ── Widget visibility ─────────────────────────────────────────────────────
  isOpen: false,

  // ── Active conversation ───────────────────────────────────────────────────
  activeSessionId: initialSessionId,
  messages: [],
  isStreaming: false,
  error: null,

  // ── Session history ───────────────────────────────────────────────────────
  sessions: [],
  isSidebarOpen: false,
  systemStatus: "connecting",

  // ── Auth ──────────────────────────────────────────────────────────────────────
  authToken: null,

  // ── Gateway ─────────────────────────────────────────────────────────────────
  // Default is read from the VITE_GATEWAY_URL build-time env var.
  // In production, set VITE_GATEWAY_URL=http://<GATEWAY_HOST_IP>:3000 in
  // widget-client/.env (or .env.production) before running `npm run build`.
  // The gateway-url HTML attribute always takes priority over this default.
  gatewayUrl: import.meta.env.VITE_GATEWAY_URL
    ? `${import.meta.env.VITE_GATEWAY_URL}/api/chat`
    : "http://localhost:3000/api/chat",

  // ── Actions ───────────────────────────────────────────────────────────────

  initUser: (userId, userRole) => set({ userId, userRole }),

  setGatewayUrl: (url) => set({ gatewayUrl: url }),

  setAuthToken: (token) =>
    set({
      authToken: token,
      userName: token ? extractUserNameFromJwt(token) : null,
    }),

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  setOpen: (open) => set({ isOpen: open }),

  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  newSession: () => {
    set({
      activeSessionId: generateSessionId(),
      messages: [],
      error: null,
      isStreaming: false,
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

  fetchSessionMessages: async (sessionId) => {
    const { userId, authToken, gatewayUrl } = get();
    const effectiveUserId = resolveUserId(userId);
    const gatewayBase = getGatewayBase(gatewayUrl);

    set({
      activeSessionId: sessionId,
      messages: [],
      error: null,
      isSidebarOpen: false,
    });

    try {
      const res = await fetch(
        `${gatewayBase}/api/chat/history/${sessionId}?userId=${encodeURIComponent(effectiveUserId)}`,
        { headers: buildAuthHeaders(authToken) }
      );
      if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
      const data: {
        sessionId: string;
        messages: Array<{
          id: string;
          role: string;
          content: string;
          createdAt: string;
        }>;
      } = await res.json();
      const messages: ChatMessage[] = (data.messages ?? []).map((m) => {
        const d = new Date(m.createdAt);
        const timeStr = isNaN(d.getTime()) ? "12:00 PM" : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return {
          id: m.id,
          role: m.role as ChatMessage["role"],
          content: m.content,
          timestamp: timeStr,
        };
      });
      set({ messages });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load session";
      set({ error: msg });
    }
  },

  loadSession: async (sessionId) => {
    await get().fetchSessionMessages(sessionId);
  },

  loadSessions: async (userId) => {
    const { authToken, gatewayUrl } = get();
    const effectiveUserId = resolveUserId(userId);
    const gatewayBase = getGatewayBase(gatewayUrl);

    try {
      const res = await fetch(
        `${gatewayBase}/api/chat/history?userId=${encodeURIComponent(effectiveUserId)}`,
        { headers: buildAuthHeaders(authToken) }
      );
      if (!res.ok) return;
      const data: {
        sessions: Array<{ id: string; title: string | null; updatedAt: string }>;
      } = await res.json();
      const sessions: ChatSession[] = (data.sessions ?? []).map((s) => ({
        id: s.id,
        title: s.title ?? null,
        date: s.updatedAt.slice(0, 10),
        updatedAt: s.updatedAt,
      }));
      set({ sessions });
    } catch {
      // Non-fatal — initializeSystem owns connectivity status.
    }
  },

  fetchHistory: async () => {
    const { userId } = get();
    await get().loadSessions(resolveUserId(userId));
  },

  initializeSystem: async () => {
    const { userId, authToken, gatewayUrl } = get();
    const effectiveUserId = resolveUserId(userId);
    const gatewayBase = getGatewayBase(gatewayUrl);

    set({ systemStatus: "connecting" });

    const [historyResult, healthResult] = await Promise.allSettled([
      fetch(
        `${gatewayBase}/api/chat/history?userId=${encodeURIComponent(effectiveUserId)}`,
        { headers: buildAuthHeaders(authToken) }
      ),
      fetch(`${gatewayBase}/api/health`, {
        headers: buildAuthHeaders(authToken),
      }),
    ]);

    const historyResponse =
      historyResult.status === "fulfilled" ? historyResult.value : null;
    const healthResponse =
      healthResult.status === "fulfilled" ? healthResult.value : null;

    if (historyResponse?.status === 401) {
      set({ systemStatus: "unauthorized" });
      return;
    }

    if (historyResponse?.status !== 200 || healthResponse?.status !== 200) {
      set({ systemStatus: "offline" });
      return;
    }

    const data: {
      sessions: Array<{ id: string; title: string | null; updatedAt: string }>;
    } = await historyResponse.json();

    const sessions: ChatSession[] = (data.sessions ?? []).map((s) => ({
      id: s.id,
      title: s.title ?? null,
      date: s.updatedAt.slice(0, 10),
      updatedAt: s.updatedAt,
    }));

    set({ sessions, systemStatus: "online" });
  },

  renameSession: async (sessionId, newTitle) => {
    const { sessions } = get();

    // Optimistic update — reflect change in UI immediately
    const previous = sessions;
    set({
      sessions: sessions.map((s) =>
        s.id === sessionId ? { ...s, title: newTitle } : s
      ),
    });

    try {
      const gatewayBase =
        import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:3000";
      const res = await fetch(
        `${gatewayBase}/api/chat/history/${sessionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        }
      );
      if (!res.ok) throw new Error(`Rename failed: ${res.status}`);
    } catch (err) {
      // Roll back optimistic update on failure
      set({ sessions: previous });
      const msg = err instanceof Error ? err.message : "Rename failed";
      set({ error: msg });
    }
  },

  addUserMessage: (content) => {
    const id = generateId();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: s.userRole, content, timestamp },
      ],
      sessions: upsertSessionOnMessage(s.sessions, s.activeSessionId, content),
    }));
    return id;
  },

  startAssistantMessage: () => {
    const id = generateId();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    set((s) => ({
      messages: [
        ...s.messages,
        { id, role: "assistant", content: "", isStreaming: true, timestamp },
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

  setStreamSources: (sources) => {
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") {
        return s;
      }
      messages[messages.length - 1] = { ...last, sources };
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
