import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { MessageSquare, ChevronDown, Settings2 } from "lucide-react";
import { fetchSettings } from "@/api/client";

const ENG_PATH_RE = /^\/engagements\/([0-9a-f-]{36})/;

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function useActiveEngagement() {
  const { pathname } = useLocation();
  const [eng, setEng] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const match = pathname.match(ENG_PATH_RE);
    if (!match) { setEng(null); return; }
    const id = match[1];
    fetch(`/engagements/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.name) setEng({ id, name: data.name });
        else setEng({ id, name: id.slice(0, 8) });
      })
      .catch(() => setEng({ id, name: id.slice(0, 8) }));
  }, [pathname]);

  return eng;
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeEng = useActiveEngagement();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "`" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [messages, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const ctx = activeEng ? `[Context: engagement "${activeEng.name}" (${activeEng.id})]\n${text}` : text;
      const res = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, { role: "user", content: ctx }] }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      const assistantId = `a-${Date.now()}`;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assistantContent += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const existing = prev.find((m) => m.id === assistantId);
            if (existing) return prev.map((m) => m.id === assistantId ? { ...m, content: assistantContent } : m);
            return [...prev, { id: assistantId, role: "assistant", content: assistantContent }];
          });
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: "assistant", content: `Error: ${err}` }]);
    }

    setIsLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 bg-primary text-primary-foreground rounded-lg px-3 py-2 flex items-center gap-2 shadow-lg hover:opacity-90 transition-opacity font-mono text-xs"
      >
        <MessageSquare className="size-3.5" />
        <span>Chat</span>
        <kbd className="text-[9px] bg-primary-foreground/20 px-1 rounded ml-1">`</kbd>
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="mx-auto max-w-5xl h-[45vh] min-h-[300px] flex flex-col bg-background border border-b-0 border-border rounded-t-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 bg-card">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-3.5 text-primary" />
              <span className="font-mono text-xs font-semibold">Chat</span>
              {activeEng && <span className="text-[9px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">{activeEng.name}</span>}
              {isLoading && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
            </div>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-muted rounded">
              <ChevronDown className="size-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground mt-12 space-y-1">
                <MessageSquare className="size-8 mx-auto text-muted-foreground/20" />
                <p className="text-xs font-mono">Ready to hack.</p>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`rounded-lg px-3 py-1.5 max-w-[70%] ${m.role === "user" ? "bg-pk-amber/15 border border-pk-amber/30" : "bg-muted"}`}>
                  <p className="whitespace-pre-wrap text-xs font-mono">{m.content}</p>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg px-3 py-1.5 text-xs font-mono animate-pulse">Thinking...</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSend} className="border-t border-border px-4 py-2 flex gap-2 shrink-0 bg-card">
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
            <button type="submit" disabled={isLoading || !input.trim()} className="bg-primary text-primary-foreground rounded-lg px-4 py-1.5 text-xs font-mono font-medium disabled:opacity-50">
              Send
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
