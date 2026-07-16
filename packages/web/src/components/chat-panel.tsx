"use client";

import dynamic from "next/dynamic";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { MessageSquare, ChevronDown, Settings2, X } from "lucide-react";

const transport = new DefaultChatTransport({ api: "/api/chat" });

const ENG_PATH_RE = /^\/engagements\/([0-9a-f-]{36})/;

function useActiveEngagement() {
  const pathname = usePathname();
  const [eng, setEng] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const match = pathname.match(ENG_PATH_RE);
    if (!match) { setEng(null); return; }
    const id = match[1];
    fetch(`/api/engagements/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.engagement) setEng({ id, name: data.engagement.name });
        else if (data?.name) setEng({ id, name: data.name });
        else setEng({ id, name: id.slice(0, 8) });
      })
      .catch(() => setEng({ id, name: id.slice(0, 8) }));
  }, [pathname]);

  return eng;
}

interface InboxMsg {
  id: string;
  direction: "inbound" | "outbound";
  author: string;
  body: string;
  createdAt: string;
}

function useConsoleToggle(onToggle: (open: boolean) => void) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "`" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        onToggle(true);
      }
      if (e.key === "Escape") {
        onToggle(false);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggle]);
}

function ConsoleShell({
  open,
  setOpen,
  children,
  title,
  badge,
  isLoading,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  children: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  isLoading?: boolean;
}) {
  return (
    <>
      {/* Trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 bg-primary text-primary-foreground rounded-lg px-3 py-2 flex items-center gap-2 shadow-lg hover:opacity-90 transition-opacity font-mono text-xs"
          title="Open console (`)"
        >
          <MessageSquare className="size-3.5" />
          <span>{title}</span>
          {isLoading && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground animate-pulse" />}
          <kbd className="text-[9px] bg-primary-foreground/20 px-1 rounded ml-1">`</kbd>
        </button>
      )}

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] transition-opacity"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Console panel */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 transition-transform duration-200 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mx-auto max-w-5xl h-[45vh] min-h-[300px] flex flex-col bg-background border border-b-0 border-border rounded-t-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 bg-card">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-3.5 text-primary" />
              <span className="font-mono text-xs font-semibold">{title}</span>
              {badge}
              {isLoading && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
            </div>
            <div className="flex items-center gap-1">
              <a href="/settings" className="p-1 hover:bg-muted rounded" title="Settings">
                <Settings2 className="size-3 text-muted-foreground" />
              </a>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded" title="Close (Esc)">
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {children}
        </div>
      </div>
    </>
  );
}

function HarnessInbox({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const [msgs, setMsgs] = useState<InboxMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchMsgs = useCallback(async () => {
    try {
      const res = await fetch("/api/messages?engagementId=all");
      if (res.ok) setMsgs(await res.json());
    } catch { /* retry */ }
  }, []);

  useEffect(() => {
    fetchMsgs();
    const interval = setInterval(fetchMsgs, 3000);
    return () => clearInterval(interval);
  }, [fetchMsgs]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [msgs, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;
    setSending(true);
    setInput("");
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, direction: "inbound", author: "human" }),
    }).catch(() => {});
    await fetchMsgs();
    setSending(false);
  }

  return (
    <ConsoleShell
      open={open}
      setOpen={setOpen}
      title="Inbox"
      badge={<span className="text-[9px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Harness</span>}
    >
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {msgs.length === 0 && (
          <div className="text-center text-muted-foreground mt-12 space-y-1">
            <MessageSquare className="size-8 mx-auto text-muted-foreground/20" />
            <p className="text-xs font-mono">No messages yet.</p>
            <p className="text-[10px] text-primary/40 italic font-mono mt-2">it&apos;s quiet... too quiet</p>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "inbound" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[70%]">
              <div className={`rounded-lg px-3 py-1.5 text-xs font-mono whitespace-pre-wrap ${
                m.direction === "inbound"
                  ? "bg-pk-amber/15 border border-pk-amber/30"
                  : "bg-muted"
              }`}>
                {m.body}
              </div>
              <span className="text-[9px] text-muted-foreground font-mono px-1">
                {m.author} &middot; {new Date(m.createdAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-border px-4 py-2 flex gap-2 shrink-0 bg-card">
        <div className="flex-1 flex items-center gap-2 bg-muted rounded-lg px-3">
          <span className="text-primary/50 font-mono text-xs select-none">&gt;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message the orchestrator..."
            className="flex-1 bg-transparent py-1.5 text-xs font-mono focus:outline-none"
            disabled={sending}
          />
        </div>
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-1.5 text-xs font-mono font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </ConsoleShell>
  );
}

function ChatPanelInner() {
  const [open, setOpen] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [mode, setMode] = useState<string>("loading");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";
  const activeEng = useActiveEngagement();

  const toggle = useCallback((v: boolean) => {
    setOpen((prev) => typeof v === "boolean" ? v : !prev);
  }, []);

  useConsoleToggle(toggle);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : {})
      .then((s) => {
        const m = ((s as Record<string, unknown>)["chat.mode"] as string) ?? "harness";
        setMode(m);
      })
      .catch(() => setMode("harness"));
  }, []);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, open]);

  if (mode === "loading") return null;

  if (mode === "harness") {
    return <HarnessInbox open={open} setOpen={setOpen} />;
  }

  return (
    <ConsoleShell
      open={open}
      setOpen={setOpen}
      title="Chat"
      isLoading={isLoading}
      badge={
        <>
          {activeEng && (
            <span className="text-[9px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded ml-1 truncate max-w-[150px]">
              {activeEng.name}
            </span>
          )}
          <label className="flex items-center gap-1 text-[9px] text-muted-foreground cursor-pointer ml-2">
            <input
              type="checkbox"
              checked={showTools}
              onChange={(e) => setShowTools(e.target.checked)}
            className="rounded h-2.5 w-2.5"
          />
          Tools
        </label>
        </>
      }
    >
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground mt-12 space-y-1">
            <MessageSquare className="size-8 mx-auto text-muted-foreground/20" />
            <p className="text-xs font-mono">Ready to hack.</p>
            <p className="text-[10px] text-muted-foreground/60">Create an engagement or ask a question.</p>
            <p className="text-[10px] text-primary/40 italic font-mono mt-2">authorized access only, obviously</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            {m.role === "user" ? (
              <div className="flex justify-end">
                <div className="bg-pk-amber/15 border border-pk-amber/30 rounded-lg px-3 py-1.5 max-w-[70%]">
                  {m.parts?.map((part, i) => {
                    if (part.type === "text") return <p key={i} className="whitespace-pre-wrap text-xs font-mono">{part.text}</p>;
                    return null;
                  })}
                </div>
              </div>
            ) : (
              <div className="flex justify-start">
                <div className="space-y-1 max-w-[70%]">
                  {m.parts?.map((part, i) => {
                    if (part.type === "text" && part.text) {
                      return (
                        <div key={i} className="bg-muted rounded-lg px-3 py-1.5">
                          <p className="whitespace-pre-wrap text-xs font-mono">{part.text}</p>
                        </div>
                      );
                    }
                    if (part.type.startsWith("tool-") && showTools) {
                      const tp = part as unknown as { toolName?: string; state?: string; result?: unknown };
                      return (
                        <div key={i} className="bg-muted/50 border border-border rounded px-2.5 py-1 text-[9px] font-mono">
                          <span className="text-muted-foreground">tool:</span>{" "}
                          <span className="text-blue-400">{tp.toolName}</span>
                          {tp.state === "result" && (
                            <details className="mt-0.5">
                              <summary className="cursor-pointer text-muted-foreground">result</summary>
                              <pre className="mt-0.5 overflow-x-auto text-[9px] max-h-20 overflow-y-auto">
                                {JSON.stringify(tp.result, null, 2)?.slice(0, 300)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-1.5 text-xs font-mono animate-pulse">Thinking...</div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive rounded px-3 py-1.5 text-[10px] font-mono">
            {error.message}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || isLoading) return;
          const ctx = activeEng
            ? `[Context: engagement "${activeEng.name}" (${activeEng.id})]\n${input}`
            : input;
          sendMessage({ role: "user", parts: [{ type: "text", text: ctx }] });
          setInput("");
        }}
        className="border-t border-border px-4 py-2 flex gap-2 shrink-0 bg-card"
      >
        <div className="flex-1 flex items-center gap-2 bg-muted rounded-lg px-3">
          <span className="text-primary/50 font-mono text-xs select-none">&gt;</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={activeEng ? `Ask about ${activeEng.name}...` : "Ask something..."}
            className="flex-1 bg-transparent py-1.5 text-xs font-mono focus:outline-none"
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-1.5 text-xs font-mono font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </ConsoleShell>
  );
}

export const ChatPanel = dynamic(() => Promise.resolve(ChatPanelInner), { ssr: false });
