"use client";

import dynamic from "next/dynamic";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, PanelRightClose, PanelRightOpen, Settings2 } from "lucide-react";

const transport = new DefaultChatTransport({ api: "/api/chat" });

interface InboxMsg {
  id: string;
  direction: "inbound" | "outbound";
  author: string;
  body: string;
  createdAt: string;
}

function HarnessInbox({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const [msgs, setMsgs] = useState<InboxMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;
    setSending(true);
    setInput("");
    await fetch("/api/settings").then(r => r.json()).catch(() => ({}));
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, direction: "inbound", author: "human" }),
    }).catch(() => {});
    await fetchMsgs();
    setSending(false);
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-muted border border-r-0 border-border rounded-l-lg p-2 hover:bg-muted/80 transition-colors"
          title="Open inbox"
        >
          <PanelRightOpen className="size-4 text-muted-foreground" />
        </button>
      )}
      <div className={`shrink-0 border-l border-border bg-background flex flex-col transition-all duration-200 ${open ? "w-[380px]" : "w-0 overflow-hidden"}`}>
        <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-3.5 text-pk-green" />
            <span className="font-mono text-xs font-semibold">Inbox</span>
            <span className="text-[9px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">External Harness</span>
          </div>
          <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded">
            <PanelRightClose className="size-3.5 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {msgs.length === 0 && (
            <div className="text-center text-muted-foreground mt-8 space-y-1">
              <MessageSquare className="size-8 mx-auto text-muted-foreground/30" />
              <p className="text-xs font-mono">No messages yet.</p>
              <p className="text-[10px] text-muted-foreground/60">Send a message to the orchestrator below, or wait for the harness to respond.</p>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "inbound" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[90%]">
                <div className={`rounded-lg px-2.5 py-1 text-xs font-mono whitespace-pre-wrap ${
                  m.direction === "inbound"
                    ? "bg-pk-green/15 border border-pk-green/30"
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

        <form onSubmit={handleSend} className="border-t px-2 py-1.5 flex gap-1.5 shrink-0">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message the orchestrator..."
            className="flex-1 bg-muted rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="bg-pk-green text-black rounded px-3 py-1 text-xs font-mono font-medium disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </>
  );
}

function ChatPanelInner() {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("pk-chat-open") !== "false";
  });
  const [showTools, setShowTools] = useState(false);
  const [mode, setMode] = useState<string>("loading");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const { messages, sendMessage, isLoading, error } = useChat({ transport });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : {})
      .then((s) => {
        const m = (s["chat.mode"] as string) ?? "harness";
        setMode(m);
        if (m === "harness") setOpen(false);
      })
      .catch(() => setMode("harness"));
  }, []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  useEffect(() => {
    localStorage.setItem("pk-chat-open", String(open));
  }, [open]);

  if (mode === "loading") return null;

  if (mode === "harness") {
    return <HarnessInbox open={open} setOpen={setOpen} />;
  }

  return (
    <>
      {/* Toggle button when closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-muted border border-r-0 border-border rounded-l-lg p-2 hover:bg-muted/80 transition-colors"
          title="Open chat"
        >
          <PanelRightOpen className="size-4 text-muted-foreground" />
        </button>
      )}

      {/* Side panel */}
      <div
        className={`shrink-0 border-l border-border bg-background flex flex-col transition-all duration-200 ${
          open ? "w-[380px]" : "w-0 overflow-hidden"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-3.5 text-pk-green" />
            <span className="font-mono text-xs font-semibold">Chat</span>
            {isLoading && <span className="h-1.5 w-1.5 rounded-full bg-pk-green animate-pulse" />}
          </div>
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-1 text-[9px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showTools}
                onChange={(e) => setShowTools(e.target.checked)}
                className="rounded h-2.5 w-2.5"
              />
              Tools
            </label>
            <a href="/settings" className="p-1 hover:bg-muted rounded" title="Settings">
              <Settings2 className="size-3 text-muted-foreground" />
            </a>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded" title="Close panel">
              <PanelRightClose className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground mt-8 space-y-1">
              <MessageSquare className="size-8 mx-auto text-muted-foreground/30" />
              <p className="text-xs font-mono">Ready to hack.</p>
              <p className="text-[10px] text-muted-foreground/60">Create an engagement or ask a question.</p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id}>
              {m.role === "user" ? (
                <div className="flex justify-end">
                  <div className="bg-pk-green/15 border border-pk-green/30 rounded-lg px-2.5 py-1 max-w-[90%]">
                    {m.parts?.map((part, i) => {
                      if (part.type === "text") return <p key={i} className="whitespace-pre-wrap text-xs font-mono">{part.text}</p>;
                      return null;
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="space-y-1 max-w-[90%]">
                    {m.parts?.map((part, i) => {
                      if (part.type === "text" && part.text) {
                        return (
                          <div key={i} className="bg-muted rounded-lg px-2.5 py-1">
                            <p className="whitespace-pre-wrap text-xs font-mono">{part.text}</p>
                          </div>
                        );
                      }
                      if (part.type === "tool-invocation" && showTools) {
                        return (
                          <div key={i} className="bg-muted/50 border rounded px-2 py-0.5 text-[9px] font-mono">
                            <span className="text-muted-foreground">tool:</span>{" "}
                            <span className="text-blue-400">{part.toolInvocation.toolName}</span>
                            {part.toolInvocation.state === "result" && (
                              <details className="mt-0.5">
                                <summary className="cursor-pointer text-muted-foreground">result</summary>
                                <pre className="mt-0.5 overflow-x-auto text-[9px] max-h-16 overflow-y-auto">
                                  {JSON.stringify(part.toolInvocation.result, null, 2)?.slice(0, 200)}
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
              <div className="bg-muted rounded-lg px-2.5 py-1 text-xs font-mono animate-pulse">Thinking...</div>
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 text-destructive rounded px-2.5 py-1 text-[10px] font-mono">
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
            sendMessage({ role: "user", parts: [{ type: "text", text: input }] });
            setInput("");
          }}
          className="border-t px-2 py-1.5 flex gap-1.5 shrink-0"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask something..."
            className="flex-1 bg-muted rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-pk-green text-black rounded px-3 py-1 text-xs font-mono font-medium disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </>
  );
}

export const ChatPanel = dynamic(() => Promise.resolve(ChatPanelInner), { ssr: false });
