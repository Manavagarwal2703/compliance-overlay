import { FormEvent, useRef, useEffect, useLayoutEffect, useState, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  AlertCircle,
  PanelLeft,
  Plus,
  Clock,
  ChevronRight,
  User,
  BookOpen,
  Pencil,
  Check,
  Copy,
  ChevronDown,
} from "lucide-react";
import {
  useChatStore,
  ChatSession,
  type SystemStatus,
} from "../store/useChatStore";
import { useChatStream } from "../hooks/useChatStream";

// Custom Enterprise Shield Icon
function CustomShield({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L4 5V11.09C4 16.14 7.41 20.85 12 22C16.59 20.85 20 16.14 20 11.09V5L12 2Z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 11L12 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="15" r="1" fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helper — date grouping
// ---------------------------------------------------------------------------

/** Returns today's ISO date string, e.g. "2026-06-07". */
function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the ISO date string for N days ago. */
function daysAgoDateStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type SessionGroup = {
  label: "Today" | "Previous 7 Days" | "Older";
  sessions: ChatSession[];
};

/**
 * Groups sessions into three buckets based on their `date` field (ISO date):
 * - "Today"            — date === today
 * - "Previous 7 Days"  — within the last 7 days but not today
 * - "Older"            — everything else
 *
 * Empty groups are omitted from the returned array.
 */
function groupSessionsByDate(sessions: ChatSession[]): SessionGroup[] {
  const today = todayDateStr();
  const sevenDaysAgo = daysAgoDateStr(7);

  const groups: Record<SessionGroup["label"], ChatSession[]> = {
    Today: [],
    "Previous 7 Days": [],
    Older: [],
  };

  for (const s of sessions) {
    if (s.date === today) {
      groups["Today"].push(s);
    } else if (s.date >= sevenDaysAgo) {
      groups["Previous 7 Days"].push(s);
    } else {
      groups["Older"].push(s);
    }
  }

  return (["Today", "Previous 7 Days", "Older"] as const)
    .filter((label) => groups[label].length > 0)
    .map((label) => ({ label, sessions: groups[label] }));
}

// ---------------------------------------------------------------------------
// Helper — resolve a display title for a session
// ---------------------------------------------------------------------------
function resolveTitle(session: ChatSession): string {
  if (session.title && session.title.trim().length > 0) return session.title;
  return "New Chat";
}

const EMPTY_SUGGESTIONS = [
  "What is our cybersecurity policy?",
  "Check Q2 Compliance.",
  "Why did control AC-2 fail?",
] as const;

// ---------------------------------------------------------------------------
// Sub-component: Individual session item with inline rename
// ---------------------------------------------------------------------------
interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
}

function SessionItem({ session, isActive, onSelect }: SessionItemProps) {
  const renameSession = useChatStore((s) => s.renameSession);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const displayTitle = resolveTitle(session);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation(); // don't trigger session load
    setDraft(displayTitle === "New Chat" ? "" : displayTitle);
    setIsEditing(true);
  }

  // Focus the input as soon as it mounts
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function commit() {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== displayTitle) {
      void renameSession(session.id, trimmed);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  }

  return (
    <li className="group/item">
      {isEditing ? (
        /* ── Inline rename input ── */
        <div className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-abb-primary" />
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            placeholder="Session name…"
            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-white outline-none placeholder:text-white/30 focus:outline-none"
          />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // prevent blur before click
              commit();
            }}
            className="shrink-0 rounded p-0.5 text-abb-primary hover:bg-white/10"
            aria-label="Save name"
          >
            <Check className="h-3 w-3" />
          </button>
        </div>
      ) : (
        /* ── Normal session row ── */
        <button
          type="button"
          onClick={onSelect}
          className={`group flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition ${
            isActive
              ? "bg-white/15 text-white"
              : "text-white/60 hover:bg-white/8 hover:text-white"
          }`}
        >
          <MessageSquare
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
              isActive
                ? "text-abb-primary"
                : "text-white/30 group-hover:text-white/60"
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium leading-snug">
              {displayTitle}
            </p>
          </div>

          {/* Pencil icon — appears on row hover, hidden while active to show chevron */}
          {!isActive && (
            <button
              type="button"
              onClick={startEditing}
              className="invisible ml-auto shrink-0 rounded p-0.5 text-white/30 hover:text-white/80 group-hover/item:visible focus:visible"
              aria-label={`Rename "${displayTitle}"`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}

          {isActive && (
            <>
              {/* Pencil on active row */}
              <button
                type="button"
                onClick={startEditing}
                className="invisible shrink-0 rounded p-0.5 text-white/40 hover:text-white group-hover/item:visible focus:visible"
                aria-label={`Rename "${displayTitle}"`}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-abb-primary" />
            </>
          )}
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Chat History Sidebar (date-grouped)
// ---------------------------------------------------------------------------
function ChatSidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const isSidebarOpen = useChatStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const loadSession = useChatStore((s) => s.loadSession);
  const newSession = useChatStore((s) => s.newSession);
  const userName = useChatStore((s) => s.userName);

  const displayName = userName || "You";

  const groups = groupSessionsByDate(sessions);

  return (
    <AnimatePresence>
      {/* Backdrop — closes sidebar on click outside */}
      {isSidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-10 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      {isSidebarOpen && (
        <motion.aside
          initial={{ x: "-100%" }}
          animate={{ x: 0 }}
          exit={{ x: "-100%" }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="absolute inset-y-0 left-0 z-20 flex w-64 flex-col bg-slate-900/95 text-white backdrop-blur-md shadow-[4px_0_24px_rgba(0,0,0,0.5)] border-r border-white/10"
          aria-label="Chat history sidebar"
        >
        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-abb-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-white/70">
              History
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white focus:outline-none"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Identity badge */}
        <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-abb-primary/20 text-abb-primary">
            <User className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white">{displayName}</p>
          </div>
        </div>

        {/* New Chat button */}
        <div className="px-3 pt-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={newSession}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-abb-primary/40 bg-abb-primary/10 px-3 py-2.5 text-xs font-semibold text-abb-primary transition-colors hover:bg-abb-primary hover:text-white focus:outline-none focus:ring-2 focus:ring-abb-primary"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            New Chat
          </motion.button>
        </div>

        {/* Date-grouped session list */}
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Past sessions">
          {sessions.length === 0 ? (
            <p className="px-2 text-xs text-white/40">No previous sessions.</p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  {/* Group subheading */}
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.sessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        isActive={session.id === activeSessionId}
                        onSelect={() => loadSession(session.id)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 px-4 py-3">
          <p className="text-[10px] text-white/30">Compliance Assistant v2</p>
        </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function inputPlaceholderForStatus(status: SystemStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting to Compliance Assistant...";
    case "online":
      return "Type your question...";
    case "unauthorized":
      return "Chat disabled: Authentication failed.";
    case "offline":
      return "Service temporarily unavailable.";
  }
}

function statusDotClass(status: SystemStatus): string {
  switch (status) {
    case "connecting":
      return "animate-pulse bg-amber-400";
    case "online":
      return "animate-pulse bg-green-500";
    case "offline":
    case "unauthorized":
      return "bg-red-500";
  }
}

function statusLabel(status: SystemStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "online":
      return "Online";
    case "unauthorized":
      return "Unauthorized";
    case "offline":
      return "Offline";
  }
}

// ---------------------------------------------------------------------------
// Sub-component: Backend connectivity indicator (header)
// ---------------------------------------------------------------------------
function OnlineIndicator() {
  const systemStatus = useChatStore((s) => s.systemStatus);

  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${statusDotClass(systemStatus)}`}
      title={statusLabel(systemStatus)}
      aria-label={`System status: ${statusLabel(systemStatus)}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component: ChatWidget
// ---------------------------------------------------------------------------
export function ChatWidget() {
  const isOpen = useChatStore((s) => s.isOpen);
  const userName = useChatStore((s) => s.userName);
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const toggleOpen = useChatStore((s) => s.toggleOpen);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const newSession = useChatStore((s) => s.newSession);
  const initializeSystem = useChatStore((s) => s.initializeSystem);
  const systemStatus = useChatStore((s) => s.systemStatus);
  const { sendMessage, isStreaming } = useChatStream();

  const chatEnabled = systemStatus === "online";

  const displayName = userName || "You";

  const [input, setInput] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // ── Sentinel: track which session is currently loaded ──────────────────────
  // Changes whenever a new session is loaded, triggering an immediate scroll.
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessionKeyRef = useRef<string>(activeSessionId);

  // Dual health check (DB + AI) once on mount
  useEffect(() => {
    void initializeSystem();
  }, [initializeSystem]);

  // ── Reliable scroll-to-bottom helper ────────────────────────────────────────
  const scrollToBottomInstant = () => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  };

  const scrollToBottom = () => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  };

  // ── Task 2 & 5: Auto-scroll during streaming ────────────────────────────────
  // useLayoutEffect fires synchronously after DOM paint so scrollHeight is
  // already updated when we read it — avoids the one-frame lag of useEffect.
  // We always scroll to bottom during streaming and on every new message.
  // The old 50px threshold guard has been removed so the user never misses a
  // response token.
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;

    if (isStreaming) {
      // During active stream: instant tracking — no 'smooth' to prevent jitter
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    } else if (messages.length > 0) {
      // After stream finishes or a new message lands: smooth scroll
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isStreaming]);

  // ── Task 3: Scroll to bottom on history load ────────────────────────────────
  // When the active session changes (user clicks a past session), messages are
  // async-fetched. We watch for the session ID change and immediately scroll
  // after the next paint so the most-recent messages are in view.
  useLayoutEffect(() => {
    if (activeSessionId !== sessionKeyRef.current) {
      sessionKeyRef.current = activeSessionId;
      // Instant scroll after session switch; messages may still be loading
      // but once they arrive the streaming effect above will scroll again.
      scrollToBottomInstant();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollHeight, scrollTop, clientHeight } = feedRef.current;
    setShowJumpToBottom(scrollHeight - scrollTop - clientHeight > 200);
  };

  // ── Task 4: Submission auto-scroll ──────────────────────────────────────────
  // Immediately snap to bottom so the user sees their own message and the
  // "Thinking" skeleton before the stream begins.
  const submitMessage = async () => {
    if (!chatEnabled || isStreaming) return;
    const text = input.trim();
    if (!text) return;
    setInput("");
    // Scroll before awaiting the stream so the user's message is visible
    // on the very next frame.
    requestAnimationFrame(scrollToBottomInstant);
    await sendMessage(text);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await submitMessage();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitMessage();
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleSuggestionClick = async (text: string) => {
    if (isStreaming || !chatEnabled) return;
    setInput(text);
    await sendMessage(text);
    setInput("");
  };

  return (
    <div className="font-sans text-sm antialiased">
      <AnimatePresence>
        {/* ── FAB launcher ─────────────────────────────────────────────────── */}
        {!isOpen && (
          <motion.button
            key="fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={toggleOpen}
            className="fixed bottom-6 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-abb-primary text-white shadow-[0_0_20px_rgba(215,25,32,0.4)] ring-4 ring-abb-primary/20 focus:outline-none focus:ring-abb-primary focus:ring-offset-2"
            aria-label="Open compliance chat"
          >
            <MessageSquare className="h-6 w-6" strokeWidth={2.5} fill="currentColor" />
          </motion.button>
        )}

        {/* ── Chat panel ───────────────────────────────────────────────────── */}
        {isOpen && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed bottom-6 right-6 z-[9999] flex h-[560px] w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200/60 bg-white/95 backdrop-blur-xl shadow-2xl"
          >
          {/* ── Sidebar overlay ── */}
          <ChatSidebar />

          {/* ── Header ─────────────────────────────────────────────────── */}
          <header className="relative z-0 flex items-center justify-between bg-slate-900/90 backdrop-blur-md px-4 py-3 text-white border-b border-white/10">
            <div className="flex items-center gap-2">
              {/* History toggle */}
              <div className="group relative flex">
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white focus:outline-none transition-colors"
                  aria-label="Toggle chat history"
                >
                  <PanelLeft className="h-5 w-5" strokeWidth={2.5} />
                </button>
                <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity delay-500 group-hover:opacity-100 shadow-md border border-white/10">
                  History
                </span>
              </div>

              <CustomShield className="h-5 w-5 text-abb-primary" />
              <OnlineIndicator />
              <span className="font-semibold tracking-wide">Compliance Assistant</span>
            </div>

            <div className="flex items-center gap-2">
              {/* New Chat shortcut */}
              <div className="group relative flex">
                <button
                  type="button"
                  onClick={newSession}
                  disabled={isStreaming}
                  className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white focus:outline-none disabled:opacity-40 transition-colors"
                  aria-label="New chat"
                >
                  <Plus className="h-5 w-5" strokeWidth={2.5} />
                </button>
                <span className="pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity delay-500 group-hover:opacity-100 shadow-md border border-white/10">
                  New Chat
                </span>
              </div>

              {/* Close */}
              <div className="group relative flex">
                <button
                  type="button"
                  onClick={toggleOpen}
                  className="rounded p-1 hover:bg-white/10 focus:outline-none text-white/80 transition-colors"
                  aria-label="Close chat"
                >
                  <X className="h-5 w-5" />
                </button>
                <span className="pointer-events-none absolute right-0 top-full mt-2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity delay-500 group-hover:opacity-100 shadow-md border border-white/10">
                  Close
                </span>
              </div>
            </div>
          </header>

          {/* ── Message feed ───────────────────────────────────────────── */}
          <div
            ref={feedRef}
            onScroll={handleScroll}
            className="flex-1 space-y-3 overflow-y-auto bg-abb-surface p-4"
          >
            {messages.length === 0 && (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 px-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-abb-primary/10">
                  <MessageSquare className="h-6 w-6 text-abb-primary" />
                </div>
                <p className="text-xs font-medium text-slate-500">
                  Ask about compliance, policies, or audits.
                </p>
                <div className="flex w-full flex-col items-stretch gap-2 px-4">
                  {EMPTY_SUGGESTIONS.map((suggestion, idx) => (
                    <motion.button
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1, duration: 0.3 }}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      key={suggestion}
                      type="button"
                      disabled={isStreaming || !chatEnabled}
                      onClick={() => void handleSuggestionClick(suggestion)}
                      className="flex items-center justify-between rounded-full border border-slate-200 bg-slate-50/50 px-4 py-2 text-left text-[11px] font-medium text-slate-600 shadow-sm transition-all hover:bg-slate-50 hover:border-red-200 hover:text-abb-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{suggestion}</span>
                      <ChevronRight className="ml-2 h-3 w-3 shrink-0 text-abb-primary opacity-70" />
                    </motion.button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => {
              const isAssistant = msg.role === "assistant";
              const senderLabel = isAssistant ? "Compliance Assistant" : displayName;

              return (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                key={msg.id}
                className={`flex ${
                  isAssistant ? "justify-start" : "justify-end"
                }`}
              >
                <div
                  className={`relative flex flex-col max-w-[85%] rounded-2xl px-4 py-3.5 shadow-sm ${
                    isAssistant
                      ? "border border-slate-200 bg-white text-slate-800"
                      : "border border-white/20 bg-abb-primary text-white ring-1 ring-black/5"
                  }`}
                >
                  <span
                    className={`mb-1 block text-[10px] font-semibold tracking-wide ${
                      isAssistant ? "text-slate-400" : "text-white/70"
                    }`}
                  >
                    {senderLabel}
                  </span>
                  <p className="whitespace-pre-wrap break-words">
                    {isAssistant && msg.isStreaming && !msg.content ? (
                      <span className="flex h-5 items-center gap-1.5">
                        <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.3s]"></span>
                        <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.15s]"></span>
                        <span className="block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"></span>
                      </span>
                    ) : (
                      <>
                        {msg.content}
                        {msg.isStreaming && (
                          <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current opacity-60" />
                        )}
                      </>
                    )}
                  </p>

                  {/* ── RAG Citation Pills ── */}
                  {isAssistant &&
                    msg.sources &&
                    msg.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                          <BookOpen className="h-2.5 w-2.5" />
                          Sources
                        </span>
                        {msg.sources.map((src) => (
                          <span
                            key={src}
                            title={src}
                            className="inline-flex max-w-[160px] items-center truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200"
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    )}

                  <div className={`mt-2 flex items-end justify-between gap-3 ${isAssistant ? "mt-3" : ""}`}>
                    {/* Timestamps */}
                    <span className={`text-[9px] ${isAssistant ? "text-slate-400" : "text-white/60"} mt-auto tracking-wider`}>
                      {msg.timestamp || "12:00 PM"}
                    </span>
                    
                    {/* ── Copy Action ── */}
                    {isAssistant && !msg.isStreaming && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => void handleCopy(msg.id, msg.content)}
                          className="flex items-center gap-1.5 rounded bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus:outline-none"
                          aria-label="Copy to clipboard"
                          title="Copy to clipboard"
                        >
                          {copiedMessageId === msg.id ? (
                            <>
                              <Check className="h-3 w-3 text-green-500" />
                              <span className="text-green-600">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
            })}
          </div>

          {/* ── Floating Jump to Bottom Button ── */}
          <AnimatePresence>
            {showJumpToBottom && (
              <motion.button
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.8 }}
                onClick={scrollToBottom}
                className="absolute bottom-20 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-white text-slate-600 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50 hover:text-abb-primary focus:outline-none z-10"
                aria-label="Scroll to bottom"
              >
                <ChevronDown className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* ── Error banner ────────────────────────────────────────────── */}
          {error && (
            <div className="flex items-center gap-2 border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Input bar ───────────────────────────────────────────────── */}
          <form
            onSubmit={handleSubmit}
            className="flex gap-2 border-t border-slate-200 bg-white p-3 items-end"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholderForStatus(systemStatus)}
              disabled={!chatEnabled || isStreaming}
              rows={1}
              className="no-scrollbar flex-1 resize-none overflow-y-auto rounded-xl border border-slate-200 bg-abb-surface px-3 py-2.5 leading-[1.4] text-sm outline-none transition-shadow focus:border-abb-primary focus:ring-1 focus:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!chatEnabled || isStreaming || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-abb-primary text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send message"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" strokeWidth={2.5} fill="currentColor" />
              )}
            </button>
          </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
