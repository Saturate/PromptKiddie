import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { MessageSquare, Terminal as TerminalIcon, X, Send } from "lucide-react";
import { fetchEngagements, fetchMessages, sendMessage } from "@/api/client";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  author: string;
  body: string;
  createdAt: string;
}

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

function useActiveEngagementId(): string | null {
  const location = useLocation();
  const match = location.pathname.match(/^\/engagements\/([^/]+)/);
  return match ? match[1] : null;
}

function MessagesView() {
  const routeEngId = useActiveEngagementId();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: engagements } = useQuery({
    queryKey: ["chat-engagements"],
    queryFn: () => fetchEngagements() as Promise<Array<{ id: string; name: string; status: string }>>,
    staleTime: 30_000,
  });

  const activeEng = routeEngId
    ?? engagements?.find((e) => e.status === "active")?.id
    ?? null;

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", activeEng],
    queryFn: () => fetchMessages(activeEng!) as Promise<Message[]>,
    enabled: !!activeEng,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !activeEng) return;
    await sendMessage({
      body: input.trim(),
      engagementId: activeEng,
      direction: "inbound",
      author: "human",
    });
    setInput("");
    qc.invalidateQueries({ queryKey: ["messages", activeEng] });
  }, [input, activeEng, qc]);

  if (!activeEng) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="font-mono text-xs text-muted-foreground text-center">
          Navigate to an engagement to chat with the orchestrator.
        </p>
      </div>
    );
  }

  const engName = engagements?.find((e) => e.id === activeEng)?.name;

  return (
    <div className="flex flex-col h-full">
      {engName && (
        <div className="px-3 py-1.5 border-b border-border/50">
          <span className="font-mono text-[10px] text-pk-amber">{engName}</span>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground/50 text-center py-8">No messages yet.</p>
        ) : (
          messages.map((msg: Message) => (
            <div key={msg.id} className={`flex ${msg.direction === "inbound" ? "justify-start" : "justify-end"}`}>
              <div className={`px-3 py-2 rounded-lg max-w-[85%] font-mono text-xs ${
                msg.direction === "inbound"
                  ? "bg-muted text-foreground"
                  : "bg-pk-amber/10 text-foreground border border-pk-amber/20"
              }`}>
                <div className="text-[9px] text-muted-foreground mb-0.5">{msg.author}</div>
                <div className="whitespace-pre-wrap">{msg.body}</div>
              </div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSend} className="flex gap-2 p-3 border-t border-border">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send to orchestrator..."
          className="flex-1 bg-background border border-border rounded px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button type="submit" disabled={!input.trim()} className="text-pk-amber hover:text-pk-amber/80 disabled:text-muted-foreground/30 p-1.5">
          <Send className="size-3.5" />
        </button>
      </form>
    </div>
  );
}

function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    (async () => {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("xterm/css/xterm.css");
      if (cancelled || !containerRef.current) return;

      const term = new Terminal({
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: { background: "#1a1e2e", foreground: "#b0b8d1", cursor: "#e8a040", selectionBackground: "#e8a04030" },
        cursorBlink: true,
        scrollback: 5000,
        convertEol: true,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      term.writeln("\x1b[33m[pk]\x1b[0m Waiting for agent session...");
      term.writeln("\x1b[90mConnect to a running agent from the Status page.\x1b[0m");

      const obs = new ResizeObserver(() => fit.fit());
      obs.observe(containerRef.current);

      cleanupRef.current = () => { obs.disconnect(); term.dispose(); };
    })();

    return () => { cancelled = true; cleanupRef.current?.(); cleanupRef.current = null; };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}

export function ChatPanel({ isOpen, onToggle }: ChatPanelProps) {
  const [tab, setTab] = useState<"messages" | "terminal">("messages");
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem("pk-chat-width");
    return stored ? parseInt(stored, 10) : 320;
  });
  const isDragging = useRef(false);
  const isHostMode = typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(280, Math.min(600, startWidth + (startX - moveEvent.clientX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      localStorage.setItem("pk-chat-width", String(width));
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [width]);

  if (!isOpen) return null;

  return (
    <div style={{ width }} className="border-l border-border bg-sidebar flex flex-col h-screen sticky top-0 shrink-0 relative">
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-pk-amber/30 active:bg-pk-amber/50 transition-colors z-10"
      />
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          <button
            onClick={() => setTab("messages")}
            className={`px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1 transition-colors ${
              tab === "messages" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <MessageSquare className="size-3" /> Messages
          </button>
          <button
            onClick={() => setTab("terminal")}
            className={`px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1 transition-colors ${
              tab === "terminal" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            <TerminalIcon className="size-3" /> Terminal
          </button>
        </div>
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground p-1">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "messages" ? <MessagesView /> : <TerminalView />}
      </div>

      {isHostMode && (
        <div className="px-3 py-2 border-t border-border">
          <p className="text-[9px] font-mono text-muted-foreground/50">
            host mode: use your terminal harness for direct agent control
          </p>
        </div>
      )}
    </div>
  );
}
