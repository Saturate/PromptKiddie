import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Terminal as TerminalIcon, X } from "lucide-react";

interface ChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface AgentRun {
  id: string;
  agent: string;
  phase: string;
  status: string;
  engagementId: string;
  engagementName?: string;
  startedAt: string;
}

function AgentTerminal({ agentId, onBack }: { agentId: string; onBack: () => void }) {
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

      term.writeln(`\x1b[33m[pk]\x1b[0m Connecting to agent ${agentId.slice(0, 8)}...`);

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/ws/pty?agentId=${agentId}`;
      let ws: WebSocket | null = null;

      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => term.writeln("\x1b[32m[pk]\x1b[0m Connected.");
        ws.onmessage = (e) => term.write(e.data);
        ws.onclose = () => term.writeln("\n\x1b[33m[pk]\x1b[0m Session ended.");
        ws.onerror = () => term.writeln("\x1b[31m[pk]\x1b[0m Connection failed.");
      } catch {
        term.writeln("\x1b[31m[pk]\x1b[0m WebSocket connection failed.");
      }

      const obs = new ResizeObserver(() => fit.fit());
      obs.observe(containerRef.current);

      cleanupRef.current = () => {
        obs.disconnect();
        ws?.close();
        term.dispose();
      };
    })();

    return () => { cancelled = true; cleanupRef.current?.(); cleanupRef.current = null; };
  }, [agentId]);

  return (
    <div className="flex flex-col h-full">
      <button onClick={onBack} className="px-3 py-1.5 text-left border-b border-border/50 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors">
        &larr; Back to agents
      </button>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}

function AgentList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data: status } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetch("/api/status").then(r => r.json()),
    refetchInterval: 10_000,
  });

  const agents: AgentRun[] = status?.agents?.runs ?? [];
  const running = agents.filter(a => a.status === "running");
  const recent = agents.filter(a => a.status !== "running").slice(0, 5);
  const isHostMode = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  return (
    <div className="flex-1 overflow-y-auto">
      {running.length > 0 && (
        <div className="p-3">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Running</div>
          <div className="space-y-1">
            {running.map(a => (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className="w-full text-left px-2.5 py-2 rounded-md border border-border hover:border-pk-amber/30 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-pk-amber animate-pulse shrink-0" />
                  <span className="font-mono text-xs text-foreground truncate">{a.agent}</span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground mt-0.5 pl-3">
                  {a.engagementName ?? a.engagementId.slice(0, 8)} &middot; {a.phase}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="p-3">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Recent</div>
          <div className="space-y-1">
            {recent.map(a => (
              <button
                key={a.id}
                onClick={() => onSelect(a.id)}
                className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${a.status === "ok" ? "bg-emerald-400" : "bg-red-400"}`} />
                  <span className="font-mono text-xs text-muted-foreground truncate">{a.agent}</span>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground/50 mt-0.5 pl-3">
                  {a.engagementName ?? a.engagementId.slice(0, 8)} &middot; {a.phase}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {agents.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <TerminalIcon className="size-6 text-muted-foreground/20 mb-3" />
          <p className="font-mono text-xs text-muted-foreground">No agent sessions.</p>
          <p className="font-mono text-[10px] text-muted-foreground/50 mt-1">Start an engagement to spawn agents.</p>
        </div>
      )}

      {isHostMode && (
        <div className="px-3 py-2 border-t border-border mt-auto">
          <p className="text-[9px] font-mono text-muted-foreground/50">
            host mode: agents also stream to your terminal harness
          </p>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ isOpen, onToggle }: ChatPanelProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem("pk-chat-width");
    return stored ? parseInt(stored, 10) : 320;
  });
  const isDragging = useRef(false);

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
        <div className="flex items-center gap-1.5">
          <TerminalIcon className="size-3.5 text-muted-foreground" />
          <span className="font-mono text-[11px] font-medium">Agents</span>
        </div>
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground p-1">
          <X className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedAgent ? (
          <AgentTerminal agentId={selectedAgent} onBack={() => setSelectedAgent(null)} />
        ) : (
          <AgentList onSelect={setSelectedAgent} />
        )}
      </div>
    </div>
  );
}
