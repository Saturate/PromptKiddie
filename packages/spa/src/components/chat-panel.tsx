import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Terminal as TerminalIcon, X } from "lucide-react";

function useActiveEngagementId(): string | null {
  const location = useLocation();
  const match = location.pathname.match(/^\/engagements\/([^/]+)/);
  return match ? match[1] : null;
}

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

      const shortId = agentId.split("-").pop() ?? agentId.slice(0, 8);
      term.writeln(`\x1b[33m[pk]\x1b[0m Connecting to ${shortId}...`);

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${proto}//${window.location.host}/ws/pty?agentId=${agentId}`;
      let ws: WebSocket | null = null;
      let gotData = false;

      async function loadLogs() {
        term.writeln("\x1b[90m[pk] Loading container logs...\x1b[0m");
        try {
          const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/logs`);
          if (res.ok) {
            const text = await res.text();
            if (text && text !== "No logs available") {
              term.writeln("\x1b[90m--- container logs ---\x1b[0m");
              for (const line of text.split("\n")) term.writeln(line);
              term.writeln("\x1b[90m--- end logs ---\x1b[0m");
            } else {
              term.writeln("\x1b[90m[pk] No logs available.\x1b[0m");
            }
          }
        } catch {}
      }

      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => term.writeln("\x1b[32m[pk]\x1b[0m Connected. Waiting for output...");
        ws.onmessage = (e) => { gotData = true; term.write(e.data); };
        ws.onclose = () => {
          if (!gotData) loadLogs();
          else term.writeln("\n\x1b[33m[pk]\x1b[0m Session ended.");
        };
        ws.onerror = () => {
          term.writeln("\x1b[33m[pk]\x1b[0m Live stream unavailable.");
          loadLogs();
        };
      } catch {
        loadLogs();
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

function AgentButton({ agent, onSelect }: { agent: AgentRun; onSelect: (id: string) => void }) {
  const isRunning = agent.status === "running";
  return (
    <button
      onClick={() => onSelect(agent.id)}
      className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
        isRunning
          ? "border border-border hover:border-pk-amber/30 hover:bg-accent/50"
          : "hover:bg-accent/50"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          isRunning ? "bg-pk-amber animate-pulse" : agent.status === "ok" ? "bg-emerald-400" : "bg-red-400"
        }`} />
        <span className={`font-mono text-xs truncate ${isRunning ? "text-foreground" : "text-muted-foreground"}`}>{agent.agent}</span>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground/50 mt-0.5 pl-3">
        {agent.engagementName ?? agent.engagementId.slice(0, 8)} &middot; {agent.phase}
      </div>
    </button>
  );
}

interface DockerContainer {
  name: string;
  image: string;
  status: string;
  action?: string;
  displayName?: string;
  engagementId?: string;
}

function ContainerButton({ container, onSelect, onKill }: { container: DockerContainer; onSelect: (name: string) => void; onKill?: (name: string) => void }) {
  const isUp = container.status.startsWith("Up");
  const isWorker = container.name.startsWith("pk-worker-");
  const label = container.displayName ?? container.name.replace(/^pk-(agent|worker)-/, "").replace(/-[a-z0-9]{6}$/, "");
  const shortId = container.name.split("-").pop() ?? "";

  const handleKill = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Stop and remove ${container.name}?`)) {
      onKill?.(container.name);
    }
  };

  return (
    <div
      onClick={isWorker ? undefined : () => onSelect(container.name)}
      className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
        isWorker
          ? "border border-border/50"
          : isUp ? "border border-border hover:border-pk-amber/30 hover:bg-accent/50 cursor-pointer" : "hover:bg-accent/50 cursor-pointer"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isUp ? (isWorker ? "bg-emerald-400" : "bg-pk-amber animate-pulse") : "bg-zinc-500"}`} />
        <span className={`font-mono text-xs truncate ${isUp ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
        <span className="font-mono text-[9px] text-muted-foreground/30 ml-auto shrink-0">{shortId}</span>
        {isUp && onKill && (
          <span
            onClick={handleKill}
            className="text-muted-foreground/30 hover:text-destructive transition-colors p-0.5 shrink-0 cursor-pointer"
            title="Stop container"
          >
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </span>
        )}
      </div>
      <div className="font-mono text-[10px] text-muted-foreground/50 mt-0.5 pl-3">
        {isWorker ? "toolbox" : "agent"} &middot; {container.status}
      </div>
    </div>
  );
}

function AgentList({ onSelect }: { onSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetch("/api/status").then(r => r.json()),
    refetchInterval: 10_000,
  });
  const [showOthers, setShowOthers] = useState(false);
  const currentEngId = useActiveEngagementId();

  const handleKill = useCallback(async (name: string) => {
    try {
      await fetch(`/api/agents/${encodeURIComponent(name)}/container`, { method: "DELETE" });
      queryClient.invalidateQueries({ queryKey: ["system-status"] });
    } catch {}
  }, [queryClient]);

  // Fetch current engagement to get its slug for container name matching
  const { data: currentEng } = useQuery({
    queryKey: ["engagement", currentEngId],
    queryFn: () => fetch(`/api/engagements/${currentEngId}`).then(r => r.json()),
    enabled: !!currentEngId,
    staleTime: 60_000,
  });

  const allContainers: DockerContainer[] = (status?.containers ?? []).filter((c: DockerContainer) => c.status.startsWith("Up"));
  const agents: AgentRun[] = status?.agents?.runs ?? [];
  const isHostMode = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  // Match containers to current engagement by slug in name
  const engSlug = currentEng?.slug as string | undefined;
  const currentContainers = engSlug
    ? allContainers.filter(c => c.name.includes(engSlug.replace(/[^a-z0-9-]/g, "")))
    : [];
  const otherContainers = engSlug
    ? allContainers.filter(c => !c.name.includes(engSlug.replace(/[^a-z0-9-]/g, "")))
    : allContainers;

  const currentAgents = currentEngId ? agents.filter(a => a.engagementId === currentEngId) : [];
  const otherAgents = currentEngId ? agents.filter(a => a.engagementId !== currentEngId) : agents;

  const currentRunning = currentAgents.filter(a => a.status === "running");
  const currentRecent = currentAgents.filter(a => a.status !== "running").slice(0, 3);
  const otherRunning = otherAgents.filter(a => a.status === "running");
  const otherRecent = otherAgents.filter(a => a.status !== "running").slice(0, 5);

  const currentEngName = (currentEng?.name as string) ?? currentAgents[0]?.engagementName ?? "Current Engagement";
  const hasCurrentContent = currentContainers.length > 0 || currentRunning.length > 0 || currentRecent.length > 0;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Current engagement containers + agents */}
      {currentEngId && hasCurrentContent && (
        <div className="p-3">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">
            {currentEngName}
          </div>
          <div className="space-y-1">
            {currentContainers.map(c => <ContainerButton key={c.name} container={c} onSelect={onSelect} onKill={handleKill} />)}
            {currentRunning.map(a => <AgentButton key={a.id} agent={a} onSelect={onSelect} />)}
            {currentRecent.map(a => <AgentButton key={a.id} agent={a} onSelect={onSelect} />)}
          </div>
        </div>
      )}

      {/* Other agents (collapsible when current engagement has agents) */}
      {(otherRunning.length > 0 || otherRecent.length > 0) && (
        <div className="p-3">
          {currentEngId && currentAgents.length > 0 ? (
            <>
              <button
                onClick={() => setShowOthers(s => !s)}
                className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors mb-2"
              >
                {showOthers ? "Hide" : "Show"} other agents ({otherRunning.length + otherRecent.length})
              </button>
              {showOthers && (
                <div className="space-y-1">
                  {otherRunning.map(a => <AgentButton key={a.id} agent={a} onSelect={onSelect} />)}
                  {otherRecent.map(a => <AgentButton key={a.id} agent={a} onSelect={onSelect} />)}
                </div>
              )}
            </>
          ) : (
            <>
              {otherRunning.length > 0 && (
                <>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Running</div>
                  <div className="space-y-1 mb-3">
                    {otherRunning.map(a => <AgentButton key={a.id} agent={a} onSelect={onSelect} />)}
                  </div>
                </>
              )}
              {otherRecent.length > 0 && (
                <>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">Recent</div>
                  <div className="space-y-1">
                    {otherRecent.map(a => <AgentButton key={a.id} agent={a} onSelect={onSelect} />)}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Other containers (not matching current engagement) */}
      {otherContainers.length > 0 && (
        <div className="p-3">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/50 mb-2">
            {hasCurrentContent ? "Other containers" : "Containers"} ({otherContainers.length})
          </div>
          <div className="space-y-1">
            {otherContainers.map(c => <ContainerButton key={c.name} container={c} onSelect={onSelect} onKill={handleKill} />)}
          </div>
        </div>
      )}

      {agents.length === 0 && allContainers.length === 0 && (
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
