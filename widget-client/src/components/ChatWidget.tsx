import { FormEvent, useRef, useEffect, useState, KeyboardEvent } from "react";
import {
  MessageSquare,
  X,
  Send,
  Shield,
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
} from "lucide-react";
import { useChatStore, ChatSession } from "../store/useChatStore";
import { useChatStream } from "../hooks/useChatStream";

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
  const userRole = useChatStore((s) => s.userRole);
  const userId = useChatStore((s) => s.userId);

  const groups = groupSessionsByDate(sessions);

  return (
    <>
      {/* Backdrop — closes sidebar on click outside */}
      {isSidebarOpen && (
        <div
          className="absolute inset-0 z-10 bg-black/20 backdrop-blur-[1px]"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <aside
        className={`absolute inset-y-0 left-0 z-20 flex w-64 flex-col bg-abb-dark text-white transition-transform duration-300 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
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
        {(userId || userRole) && (
          <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-abb-primary/20 text-abb-primary">
              {userRole === "reviewer" ? (
                <Shield className="h-3.5 w-3.5" />
              ) : (
                <User className="h-3.5 w-3.5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-white">
                {userId || "Anonymous"}
              </p>
              <p className="text-[10px] capitalize text-white/50">{userRole}</p>
            </div>
          </div>
        )}

        {/* New Chat button */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={newSession}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-abb-primary/40 bg-abb-primary/10 px-3 py-2.5 text-xs font-semibold text-abb-primary transition hover:bg-abb-primary hover:text-white focus:outline-none focus:ring-2 focus:ring-abb-primary"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
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
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Role badge shown in the header (read-only, from props)
// ---------------------------------------------------------------------------
function RoleBadge() {
  const userRole = useChatStore((s) => s.userRole);
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        userRole === "reviewer"
          ? "bg-amber-400/20 text-amber-300"
          : "bg-abb-primary/20 text-abb-primary"
      }`}
    >
      {userRole === "reviewer" ? (
        <Shield className="h-2.5 w-2.5" />
      ) : (
        <User className="h-2.5 w-2.5" />
      )}
      {userRole}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component: ChatWidget
// ---------------------------------------------------------------------------
export function ChatWidget() {
  const isOpen = useChatStore((s) => s.isOpen);
  const userRole = useChatStore((s) => s.userRole);
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const toggleOpen = useChatStore((s) => s.toggleOpen);
  const toggleSidebar = useChatStore((s) => s.toggleSidebar);
  const newSession = useChatStore((s) => s.newSession);
  const fetchHistory = useChatStore((s) => s.fetchHistory);
  const { sendMessage, isStreaming } = useChatStream();

  const [input, setInput] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  // Hydrate sidebar history once on mount
  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  // Auto-scroll to newest message
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage(text);
  };

  return (
    <div className="font-sans text-sm antialiased">
      {/* ── FAB launcher ─────────────────────────────────────────────────── */}
      {!isOpen && (
        <button
          type="button"
          onClick={toggleOpen}
          className="fixed bottom-6 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-abb-primary text-white shadow-lg transition hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-abb-primary focus:ring-offset-2"
          aria-label="Open compliance chat"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {/* ── Chat panel ───────────────────────────────────────────────────── */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-[9999] flex h-[560px] w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          {/* ── Sidebar overlay ── */}
          <ChatSidebar />

          {/* ── Header ─────────────────────────────────────────────────── */}
          <header className="relative z-0 flex items-center justify-between bg-abb-dark px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              {/* History toggle */}
              <button
                type="button"
                onClick={toggleSidebar}
                className="rounded p-1 hover:bg-white/10 focus:outline-none"
                aria-label="Toggle chat history"
              >
                <PanelLeft className="h-4 w-4" />
              </button>

              <Shield className="h-5 w-5 text-abb-primary" />
              <span className="font-semibold">Compliance Assistant</span>
            </div>

            <div className="flex items-center gap-2">
              {/* Read-only role indicator */}
              <RoleBadge />

              {/* New Chat shortcut */}
              <button
                type="button"
                onClick={newSession}
                disabled={isStreaming}
                className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white focus:outline-none disabled:opacity-40"
                aria-label="New chat"
              >
                <Plus className="h-4 w-4" />
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={toggleOpen}
                className="rounded p-1 hover:bg-white/10 focus:outline-none"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>

          {/* ── Message feed ───────────────────────────────────────────── */}
          <div
            ref={feedRef}
            className="flex-1 space-y-3 overflow-y-auto bg-abb-surface p-4"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 pt-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-abb-primary/10">
                  <MessageSquare className="h-6 w-6 text-abb-primary" />
                </div>
                <p className="text-xs font-medium text-slate-500">
                  {userRole === "reviewer"
                    ? "Run a compliance check or ask about audit findings."
                    : "Ask about compliance, policies, or audits."}
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "assistant" ? "justify-start" : "justify-end"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                    msg.role === "assistant"
                      ? "bg-white text-slate-800 shadow-sm"
                      : msg.role === "reviewer"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-abb-primary text-white"
                  }`}
                >
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-60">
                    {msg.role}
                  </span>
                  <p className="whitespace-pre-wrap break-words">
                    {msg.role === "assistant" && msg.isStreaming && !msg.content ? (
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
                  {msg.role === "assistant" &&
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
                </div>
              </div>
            ))}
          </div>

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
            className="flex gap-2 border-t border-slate-200 bg-white p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                userRole === "reviewer"
                  ? "Run compliance check…"
                  : "Type your question…"
              }
              disabled={isStreaming}
              className="flex-1 rounded-xl border border-slate-200 bg-abb-surface px-3 py-2 text-sm outline-none focus:border-abb-primary focus:ring-1 focus:ring-abb-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-abb-primary text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send message"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
