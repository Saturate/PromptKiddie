"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { ActionGraphView } from "@/components/graph/action-graph";
import { ActionDetail, type ActionDetailData } from "@/components/graph/action-detail";
import type { ActionNodeData } from "@/components/graph/action-node";
import { Copy, Check, Play, Pause, RotateCcw, Zap, Radio, X, ChevronDown } from "lucide-react";
import { useLiveMode, type LiveEvent, type LiveOutputLine } from "@/hooks/use-live-mode";
import type { ActionGraph, ActionNode } from "@promptkiddie/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionNodeWithState extends ActionNode {
  running: number;
  eventCount: number;
}

interface GraphResponse {
  graph: ActionGraph & { nodes: ActionNodeWithState[] };
  mermaid: string;
}

interface EngagementSummary {
  id: string;
  name: string;
  phase: string;
  group: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Demo event sequence (based on a real CTF engagement)
// ---------------------------------------------------------------------------

interface DemoEvent {
  type: string;
  payload: Record<string, unknown>;
  delay: number;
}

const DEMO_EVENTS: DemoEvent[] = [
  { type: "EngagementStarted", payload: {}, delay: 0 },
  { type: "PortDiscovered", payload: { port: 22, service: "ssh", version: "OpenSSH 10.0p2" }, delay: 800 },
  { type: "PortDiscovered", payload: { port: 80, service: "http", version: "nginx 1.28.0" }, delay: 200 },
  { type: "PortDiscovered", payload: { port: 1515, service: "unknown", version: null }, delay: 200 },
  { type: "VersionIdentified", payload: { product: "nginx", version: "1.28.0" }, delay: 1500 },
  { type: "HostnameFound", payload: { hostname: "paperwork.htb", source: "http_redirect" }, delay: 500 },
  { type: "VersionIdentified", payload: { product: "Flask", version: null }, delay: 1000 },
  { type: "PathDiscovered", payload: { url: "/download/archive", status: 200 }, delay: 2000 },
  { type: "FileDownloaded", payload: { path: "server.py", type: "python" }, delay: 500 },
  { type: "FindingAdded", payload: { title: "OS Command Injection in LPD", severity: "critical" }, delay: 2000 },
  { type: "ShellObtained", payload: { user: "lp", method: "command_injection" }, delay: 3000 },
  { type: "CredentialFound", payload: { username: "root", source: "SCM_RIGHTS FD leak" }, delay: 4000 },
  { type: "FlagCaptured", payload: { type: "user", value: "03b8fd38..." }, delay: 1000 },
  { type: "FlagCaptured", payload: { type: "root", value: "1544d3d2..." }, delay: 2000 },
];

function eventSummary(e: DemoEvent | LiveEvent): string {
  const p = e.payload;
  switch (e.type) {
    case "PortDiscovered":
      return `${p.port}/${p.service}${p.version ? ` (${p.version})` : ""}`;
    case "VersionIdentified":
      return `${p.product}${p.version ? ` ${p.version}` : ""}`;
    case "HostnameFound":
      return String(p.hostname);
    case "FileDownloaded":
      return String(p.path);
    case "FindingAdded":
      return `${p.severity}: ${p.title}`;
    case "ShellObtained":
      return `${p.user} via ${p.method}`;
    case "CredentialFound":
      return `${p.username} (${p.source})`;
    case "FlagCaptured":
      return `${p.type} flag`;
    case "PathDiscovered":
      return `${p.url} [${p.status}]`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Build trigger map from node emits arrays (client-side cascade simulation)
// ---------------------------------------------------------------------------

/** Map event type -> action IDs that emit it */
function buildEmitterMap(nodes: ActionNodeWithState[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of nodes) {
    for (const eventType of node.emits) {
      const list = map.get(eventType) ?? [];
      list.push(node.id);
      map.set(eventType, list);
    }
  }
  return map;
}

/** Map event type -> action IDs that would trigger on it (reverse of emits) */
function buildConsumerMap(
  nodes: ActionNodeWithState[],
  edges: ActionGraph["edges"],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.event) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    map.set(edge.event, list);
  }
  // EngagementStarted consumers from __start__ edges
  const startEdges = edges.filter((e) => e.from === "__start__");
  if (startEdges.length > 0) {
    const existing = map.get("EngagementStarted") ?? [];
    for (const se of startEdges) {
      if (!existing.includes(se.to)) existing.push(se.to);
    }
    map.set("EngagementStarted", existing);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Simulation hook
// ---------------------------------------------------------------------------

interface SimState {
  playing: boolean;
  currentIndex: number;
  activeNodes: Set<string>;
  doneNodes: Set<string>;
  activeEdges: Set<string>;
  log: Array<{ time: number; event: DemoEvent }>;
  speed: number;
}

function useSimulation(graph: GraphResponse["graph"] | null) {
  const [state, setState] = useState<SimState>({
    playing: false,
    currentIndex: -1,
    activeNodes: new Set(),
    doneNodes: new Set(),
    activeEdges: new Set(),
    log: [],
    speed: 1,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState({
      playing: false,
      currentIndex: -1,
      activeNodes: new Set(),
      doneNodes: new Set(),
      activeEdges: new Set(),
      log: [],
      speed: stateRef.current.speed,
    });
  }, []);

  const stepTo = useCallback((index: number) => {
    const g = graphRef.current;
    if (!g || index >= DEMO_EVENTS.length) {
      // Simulation complete
      setState((prev) => ({ ...prev, playing: false, activeNodes: new Set() }));
      return;
    }

    const event = DEMO_EVENTS[index];
    const consumerMap = buildConsumerMap(g.nodes, g.edges);
    const emitterMap = buildEmitterMap(g.nodes);

    const triggered = consumerMap.get(event.type) ?? [];
    const emitters = emitterMap.get(event.type) ?? [];

    const newActive = new Set(triggered);
    const newActiveEdges = new Set<string>();
    for (const emitter of emitters) {
      for (const consumer of triggered) {
        newActiveEdges.add(`${emitter}->${consumer}`);
      }
    }
    // Start node edges for EngagementStarted
    if (event.type === "EngagementStarted") {
      for (const consumer of triggered) {
        newActiveEdges.add(`__start__->${consumer}`);
      }
    }

    const elapsedMs = DEMO_EVENTS.slice(0, index + 1).reduce((sum, e) => sum + e.delay, 0);

    setState((prev) => ({
      ...prev,
      currentIndex: index,
      activeNodes: newActive,
      activeEdges: newActiveEdges,
      doneNodes: new Set([...prev.doneNodes, ...prev.activeNodes]),
      log: [...prev.log, { time: elapsedMs / 1000, event }],
    }));

    // Schedule next step
    if (index + 1 < DEMO_EVENTS.length && stateRef.current.playing) {
      const nextDelay = DEMO_EVENTS[index + 1].delay / stateRef.current.speed;
      timerRef.current = setTimeout(() => stepTo(index + 1), Math.max(nextDelay, 100));
    } else if (index + 1 >= DEMO_EVENTS.length) {
      // Mark final active nodes as done after a short delay
      setTimeout(() => {
        setState((prev) => ({
          ...prev,
          playing: false,
          doneNodes: new Set([...prev.doneNodes, ...prev.activeNodes]),
          activeNodes: new Set(),
          activeEdges: new Set(),
        }));
      }, 1000 / stateRef.current.speed);
    }
  }, []);

  const play = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, playing: true };
      return next;
    });
    const startIdx = stateRef.current.currentIndex + 1;
    if (startIdx === 0) {
      stepTo(0);
    } else {
      // Resume
      const nextDelay = startIdx < DEMO_EVENTS.length
        ? DEMO_EVENTS[startIdx].delay / stateRef.current.speed
        : 0;
      timerRef.current = setTimeout(() => stepTo(startIdx), Math.max(nextDelay, 100));
    }
  }, [stepTo]);

  const pause = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((prev) => ({ ...prev, playing: false }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState((prev) => ({ ...prev, speed }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // When playing state changes and we're mid-simulation, kick the next step
  useEffect(() => {
    if (state.playing && state.currentIndex >= 0) {
      const nextIdx = state.currentIndex + 1;
      if (nextIdx < DEMO_EVENTS.length) {
        const nextDelay = DEMO_EVENTS[nextIdx].delay / state.speed;
        timerRef.current = setTimeout(() => stepTo(nextIdx), Math.max(nextDelay, 100));
      }
    }
    // Only re-run when speed changes during playback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.speed]);

  return { state, play, pause, reset, setSpeed };
}

// ---------------------------------------------------------------------------
// Engagement selector
// ---------------------------------------------------------------------------

function EngagementSelector({
  onSelect,
  selected,
}: {
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchEngagements = useCallback(() => {
    setLoading(true);
    fetch("/api/engagements")
      .then((r) => r.json())
      .then((data: EngagementSummary[]) => {
        setEngagements(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleToggle = useCallback(() => {
    if (!open) fetchEngagements();
    setOpen((prev) => !prev);
  }, [open, fetchEngagements]);

  const selectedName = engagements.find((e) => e.id === selected)?.name;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        {selectedName ?? "Select engagement"}
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[240px] rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          {loading ? (
            <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground animate-pulse">
              Loading...
            </div>
          ) : engagements.length === 0 ? (
            <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground">
              No engagements found
            </div>
          ) : (
            engagements.map((eng) => (
              <button
                key={eng.id}
                onClick={() => {
                  onSelect(eng.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[10px] font-mono hover:bg-muted transition-colors ${
                  eng.id === selected ? "bg-pk-amber/10 text-pk-amber" : "text-foreground"
                }`}
              >
                <div className="font-semibold truncate">{eng.name}</div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{eng.phase}</span>
                  <span className="text-muted-foreground/50">|</span>
                  <span>{eng.status}</span>
                  {eng.group && (
                    <>
                      <span className="text-muted-foreground/50">|</span>
                      <span>{eng.group}</span>
                    </>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

type Mode = "idle" | "simulate" | "live";

const SPEED_OPTIONS = [1, 2, 4];

export default function PlaybookPage() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<GraphResponse | null>(null);
  const [view, setView] = useState<"graph" | "mermaid">("graph");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<ActionDetailData | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [engagementId, setEngagementId] = useState<string | null>(
    searchParams.get("engagement"),
  );

  const sim = useSimulation(data?.graph ?? null);
  const live = useLiveMode({
    graph: data?.graph ?? null,
    engagementId,
  });

  // Derive which set of nodes/edges to pass to the graph
  const activeNodes = mode === "live" ? live.state.activeNodes : sim.state.activeNodes;
  const doneNodes = mode === "live" ? live.state.doneNodes : sim.state.doneNodes;
  const activeEdges = mode === "live" ? live.state.activeEdges : sim.state.activeEdges;

  useEffect(() => {
    fetch("/api/playbook/actions")
      .then((r) => r.json())
      .then((d: GraphResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // If engagement comes from URL, auto-start live mode once graph is loaded
  useEffect(() => {
    const urlEngagement = searchParams.get("engagement");
    if (urlEngagement && data && mode === "idle") {
      setEngagementId(urlEngagement);
      setMode("live");
    }
  }, [searchParams, data, mode]);

  // Connect/disconnect WebSocket when live mode toggles
  useEffect(() => {
    if (mode === "live" && engagementId) {
      live.connect();
    } else {
      live.disconnect();
    }
    // Only react to mode and engagementId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, engagementId]);

  const startSimulation = useCallback(() => {
    if (mode === "live") {
      live.disconnect();
    }
    setMode("simulate");
    sim.play();
  }, [mode, live, sim]);

  const startLive = useCallback((id: string) => {
    if (mode === "simulate") {
      sim.reset();
    }
    setEngagementId(id);
    setMode("live");
  }, [mode, sim]);

  const stopLive = useCallback(() => {
    live.disconnect();
    setMode("idle");
  }, [live]);

  const copyMermaid = useCallback(() => {
    if (!data) return;
    navigator.clipboard.writeText(data.mermaid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  // Filter output lines for the selected action in the sidebar
  const selectedActionOutputLines = selectedAction
    ? live.state.outputLines.filter(
        (l) => l.action.toLowerCase() === selectedAction.name.toLowerCase(),
      )
    : [];

  // Filter live events for the selected action (by source matching action name)
  const selectedActionEvents = selectedAction
    ? live.state.log.filter(
        (e) => e.source.toLowerCase() === selectedAction.name.toLowerCase(),
      )
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-muted-foreground font-mono text-sm animate-pulse">Loading action graph...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-muted-foreground font-mono text-sm">Failed to load action graph</span>
      </div>
    );
  }

  const isSimulating = sim.state.currentIndex >= 0;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-mono font-semibold">Playbook</h1>
          <p className="text-xs text-muted-foreground font-mono">
            {data.graph.nodes.length} actions, {data.graph.edges.length} connections
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Simulate controls */}
          <div className="flex items-center gap-1 mr-2">
            {mode !== "live" && (
              <>
                {!sim.state.playing ? (
                  <button
                    onClick={startSimulation}
                    disabled={sim.state.currentIndex >= DEMO_EVENTS.length - 1 && isSimulating}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-pk-amber/10 text-pk-amber hover:bg-pk-amber/20 transition-colors disabled:opacity-40"
                  >
                    <Play className="size-3" />
                    {isSimulating ? "Resume" : "Simulate"}
                  </button>
                ) : (
                  <button
                    onClick={sim.pause}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-pk-amber/10 text-pk-amber hover:bg-pk-amber/20 transition-colors"
                  >
                    <Pause className="size-3" />
                    Pause
                  </button>
                )}
                {isSimulating && (
                  <button
                    onClick={() => {
                      sim.reset();
                      setMode("idle");
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="size-3" />
                    Reset
                  </button>
                )}
                {mode === "simulate" && (
                  <div className="flex items-center gap-0.5 ml-1">
                    <Zap className="size-3 text-muted-foreground" />
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => sim.setSpeed(s)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                          sim.state.speed === s
                            ? "bg-pk-amber/20 text-pk-amber"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Live mode controls */}
            {mode === "live" ? (
              <div className="flex items-center gap-1">
                <span className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-red-500/10 text-red-400">
                  <Radio className="size-3 animate-pulse" />
                  Live
                  {live.state.connected ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 ml-0.5" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 ml-0.5" />
                  )}
                </span>
                <EngagementSelector
                  selected={engagementId}
                  onSelect={startLive}
                />
                <button
                  onClick={stopLive}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-3" />
                  Stop
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <EngagementSelector
                  selected={engagementId}
                  onSelect={startLive}
                />
                {engagementId && (
                  <button
                    onClick={() => startLive(engagementId)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <Radio className="size-3" />
                    Live
                  </button>
                )}
              </div>
            )}
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setView("graph")}
              className={`font-mono text-[10px] px-2 py-0.5 rounded transition-colors ${
                view === "graph" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Graph
            </button>
            <button
              onClick={() => setView("mermaid")}
              className={`font-mono text-[10px] px-2 py-0.5 rounded transition-colors ${
                view === "mermaid" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Mermaid
            </button>
          </div>
        </div>
      </div>

      {/* Graph / Mermaid view */}
      {view === "graph" ? (
        <ReactFlowProvider>
          <ActionGraphView
            graph={data.graph}
            activeNodes={activeNodes}
            doneNodes={doneNodes}
            activeEdges={activeEdges}
            onNodeClick={(nodeId, nodeData) => {
              const node = data.graph.nodes.find((n) => n.id === nodeId);
              if (!node) return;
              const triggeredByEvents = data.graph.edges
                .filter((e) => e.to === nodeId)
                .map((e) => e.event)
                .filter((v, i, a) => a.indexOf(v) === i);
              const triggersActions = data.graph.edges
                .filter((e) => e.from === nodeId)
                .map((e) => e.to)
                .filter((v, i, a) => a.indexOf(v) === i);
              setSelectedAction({
                ...nodeData,
                id: nodeId,
                triggeredBy: triggeredByEvents,
                triggers: triggersActions,
              });
            }}
          />
        </ReactFlowProvider>
      ) : (
        <div className="relative">
          <button
            onClick={copyMermaid}
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-muted text-muted-foreground hover:text-foreground transition-colors z-10"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <pre className="rounded-lg border border-border bg-card p-4 text-xs font-mono text-foreground overflow-x-auto max-h-[600px] overflow-y-auto">
            {data.mermaid}
          </pre>
        </div>
      )}

      {/* Simulation event log */}
      {mode === "simulate" && isSimulating && (
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Event Log
          </h3>
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {sim.state.log.map((entry, i) => (
              <div
                key={i}
                className={`flex items-baseline gap-2 text-[10px] font-mono ${
                  i === sim.state.log.length - 1 ? "text-pk-amber" : "text-muted-foreground"
                }`}
              >
                <span className="text-muted-foreground/50 tabular-nums shrink-0 w-[4ch] text-right">
                  {entry.time.toFixed(1)}s
                </span>
                <span className="font-semibold">{entry.event.type}</span>
                <span className="text-muted-foreground/60 truncate">
                  {eventSummary(entry.event)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live event log */}
      {mode === "live" && live.state.log.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            <span className="flex items-center gap-1.5">
              <Radio className="size-3 text-red-400 animate-pulse" />
              Live Event Log
              <span className="text-muted-foreground/50 tabular-nums">{live.state.log.length} events</span>
            </span>
          </h3>
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {live.state.log.map((entry, i) => {
              const time = new Date(entry.time);
              const ts = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}`;
              return (
                <div
                  key={i}
                  className={`flex items-baseline gap-2 text-[10px] font-mono ${
                    i === live.state.log.length - 1 ? "text-pk-amber" : "text-muted-foreground"
                  }`}
                >
                  <span className="text-muted-foreground/50 tabular-nums shrink-0 w-[7ch] text-right">
                    {ts}
                  </span>
                  <span className="font-semibold">{entry.type}</span>
                  <span className="text-muted-foreground/60 truncate">
                    {eventSummary(entry)}
                  </span>
                  <span className="text-muted-foreground/30 ml-auto shrink-0">
                    {entry.source}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ActionDetail
        action={selectedAction}
        open={selectedAction !== null}
        onClose={() => setSelectedAction(null)}
        liveOutputLines={mode === "live" ? selectedActionOutputLines : undefined}
        liveEvents={mode === "live" ? selectedActionEvents : undefined}
        isLive={mode === "live"}
      />
    </div>
  );
}
