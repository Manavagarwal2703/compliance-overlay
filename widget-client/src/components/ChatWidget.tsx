import { FormEvent, useRef, useEffect, useState } from "react";
import {
  MessageSquare,
  X,
  Send,
  Shield,
  User,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useChatStore, type ChatRole } from "../store/useChatStore";
import { useChatStream } from "../hooks/useChatStream";

export function ChatWidget() {
  const isOpen = useChatStore((s) => s.isOpen);
  const activeRole = useChatStore((s) => s.activeRole);
  const messages = useChatStore((s) => s.messages);
  const error = useChatStore((s) => s.error);
  const toggleOpen = useChatStore((s) => s.toggleOpen);
  const setActiveRole = useChatStore((s) => s.setActiveRole);
  const { sendMessage, isStreaming } = useChatStream();

  const [input, setInput] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) {
      return;
    }
    setInput("");
    await sendMessage(text);
  };

  const setRole = (role: ChatRole) => {
    if (!isStreaming) {
      setActiveRole(role);
    }
  };

  return (
    <div className="font-sans text-sm antialiased">
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

      {isOpen && (
        <div className="fixed bottom-6 right-6 z-[9999] flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between bg-abb-dark px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-abb-primary" />
              <span className="font-semibold">Compliance Assistant</span>
            </div>
            <button
              type="button"
              onClick={toggleOpen}
              className="rounded p-1 hover:bg-white/10 focus:outline-none"
              aria-label="Close chat"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="flex border-b border-slate-200 bg-abb-surface px-3 py-2">
            <button
              type="button"
              onClick={() => setRole("user")}
              disabled={isStreaming}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                activeRole === "user"
                  ? "bg-white text-abb-dark shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <User className="h-3.5 w-3.5" />
              User
            </button>
            <button
              type="button"
              onClick={() => setRole("reviewer")}
              disabled={isStreaming}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                activeRole === "reviewer"
                  ? "bg-white text-abb-dark shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Shield className="h-3.5 w-3.5" />
              Reviewer
            </button>
          </div>

          <div
            ref={feedRef}
            className="flex-1 space-y-3 overflow-y-auto bg-abb-surface p-4"
          >
            {messages.length === 0 && (
              <p className="text-center text-xs text-slate-400">
                Ask about compliance, policies, or audits.
              </p>
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
                    {msg.content}
                    {msg.isStreaming && (
                      <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current opacity-60" />
                    )}
                  </p>
                </div>
              </div>
            ))}
            {isStreaming && messages.length > 0 && !messages.at(-1)?.content && (
              <div className="flex justify-start">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="flex gap-2 border-t border-slate-200 bg-white p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                activeRole === "reviewer"
                  ? "Run compliance check..."
                  : "Type your question..."
              }
              disabled={isStreaming}
              className="flex-1 rounded-xl border border-slate-200 bg-abb-surface px-3 py-2 text-sm outline-none focus:border-abb-primary focus:ring-1 focus:ring-abb-primary disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-abb-primary text-white transition hover:bg-red-700 disabled:opacity-40"
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
