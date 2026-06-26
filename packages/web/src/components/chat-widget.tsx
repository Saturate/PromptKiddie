"use client";

import dynamic from "next/dynamic";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect } from "react";
import { MessageSquare, X, ChevronDown } from "lucide-react";

const transport = new DefaultChatTransport({ api: "/api/chat" });

function ChatWidgetInner() {
  const [open, setOpen] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [mode, setMode] = useState<string>("loading");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.ok ? r.json() : {})
      .then((s) => setMode((s["chat.mode"] as string) ?? "floating"))
      .catch(() => setMode("floating"));
  }, []);

  if (mode === "loading" || mode === "harness") return null;

  const { messages, sendMessage, isLoading, error } = useChat({ transport });

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-pk-green text-black rounded-full p-3.5 shadow-lg hover:scale-105 transition-transform"
        title="Open chat"
      >
        <MessageSquare className="size-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[420px] h-[600px] max-h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-pk-green" />
          <span className="font-mono text-sm font-semibold">PromptKiddie</span>
          {isLoading && <span className="h-2 w-2 rounded-full bg-pk-green animate-pulse" />}
        </div>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showTools}
              onChange={(e) => setShowTools(e.target.checked)}
              className="rounded h-3 w-3"
            />
            Tools
          </label>
          <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded" title="Minimize">
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
          <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded" title="Close">
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground mt-12">
            <p className="text-sm font-mono mb-1">Ready to hack.</p>
            <p className="text-xs">Try: &quot;Create a CTF for THM Clocky&quot;</p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            {m.role === "user" ? (
              <div className="flex justify-end">
                <div className="bg-pk-green/15 border border-pk-green/30 rounded-lg px-3 py-1.5 max-w-[85%]">
                  {m.parts?.map((part, i) => {
                    if (part.type === "text") return <p key={i} className="whitespace-pre-wrap text-sm font-mono">{part.text}</p>;
                    return null;
                  })}
                </div>
              </div>
            ) : (
              <div className="flex justify-start">
                <div className="space-y-1.5 max-w-[85%]">
                  {m.parts?.map((part, i) => {
                    if (part.type === "text" && part.text) {
                      return (
                        <div key={i} className="bg-muted rounded-lg px-3 py-1.5">
                          <p className="whitespace-pre-wrap text-sm font-mono">{part.text}</p>
                        </div>
                      );
                    }
                    if (part.type === "tool-invocation" && showTools) {
                      return (
                        <div key={i} className="bg-muted/50 border rounded-lg px-2 py-1 text-[10px] font-mono">
                          <span className="text-muted-foreground">tool: </span>
                          <span className="text-blue-400">{part.toolInvocation.toolName}</span>
                          {part.toolInvocation.state === "result" && (
                            <details className="mt-0.5">
                              <summary className="cursor-pointer text-muted-foreground">result</summary>
                              <pre className="mt-0.5 overflow-x-auto text-[10px] max-h-24 overflow-y-auto">
                                {JSON.stringify(part.toolInvocation.result, null, 2)?.slice(0, 300)}
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
            <div className="bg-muted rounded-lg px-3 py-1.5 text-sm font-mono animate-pulse">Thinking...</div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive rounded-lg px-3 py-1.5 text-xs font-mono">
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
        className="border-t px-3 py-2 flex gap-2 shrink-0"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask PromptKiddie..."
          className="flex-1 bg-muted rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="bg-pk-green text-black rounded-lg px-4 py-1.5 text-sm font-mono font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export const ChatWidget = dynamic(() => Promise.resolve(ChatWidgetInner), { ssr: false });
