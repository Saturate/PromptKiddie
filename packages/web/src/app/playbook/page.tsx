"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { ActionGraphView } from "@/components/graph/action-graph";
import { ActionDetail, type ActionDetailData } from "@/components/graph/action-detail";
import type { ActionNodeData, CoverageStatus } from "@/components/graph/action-node";
import { Copy, Check, Play, Pause, RotateCcw, Zap, Radio, X, ChevronDown, Film, FlaskConical } from "lucide-react";
import { useReplay, type ReplayEvent } from "@/hooks/use-replay";
import { type ActionNodeWithState, eventSummary, formatDuration } from "@/hooks/graph-helpers";
import type { ActionGraph } from "@promptkiddie/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlaybookInfo {
  key: string;
  name: string;
}

interface GraphResponse {
  playbook: PlaybookInfo;
  available: PlaybookInfo[];
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

type Mode = "idle" | "replay" | "live";

const SPEED_OPTIONS = [1, 2, 4, 8];

export default function PlaybookPage() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<GraphResponse | null>(null);
  const [playbookKey, setPlaybookKey] = useState("ctf");
  const [view, setView] = useState<"graph" | "mermaid">("graph");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<ActionDetailData | null>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [engagementId, setEngagementId] = useState<string | null>(
    searchParams.get("engagement"),
  );

  const replay = useReplay({ graph: data?.graph ?? null });

  const [coverage, setCoverage] = useState<Record<string, CoverageStatus> | null>(null);
  const [coverageSummary, setCoverageSummary] = useState<{ total: number; passing: number; failing: number; untested: number } | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const activeNodes = replay.state.activeNodes;
  const doneNodes = replay.state.doneNodes;
  const activeEdges = replay.state.activeEdges;

  const fetchCoverage = useCallback((key: string) => {
    setCoverageLoading(true);
    fetch(`/api/playbook/coverage?playbook=${key}`)
      .then((r) => r.json())
      .then((d: { coverage: Record<string, CoverageStatus>; summary: { total: number; passing: number; failing: number; untested: number } }) => {
        setCoverage(d.coverage);
        setCoverageSummary(d.summary);
        setCoverageLoading(false);
      })
      .catch(() => setCoverageLoading(false));
  }, []);

  const toggleCoverage = useCallback(() => {
    if (coverage) {
      setCoverage(null);
      setCoverageSummary(null);
    } else {
      fetchCoverage(playbookKey);
    }
  }, [coverage, fetchCoverage, playbookKey]);

  const fetchGraph = useCallback((key: string) => {
    setLoading(true);
    setCoverage(null);
    setCoverageSummary(null);
    fetch(`/api/playbook/actions?playbook=${key}`)
      .then((r) => r.json())
      .then((d: GraphResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchGraph(playbookKey);
  }, [playbookKey, fetchGraph]);

  // If engagement comes from URL, auto-start live mode once graph is loaded
  useEffect(() => {
    const urlEngagement = searchParams.get("engagement");
    if (urlEngagement && data && mode === "idle") {
      startLive(urlEngagement);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, data]);

  useEffect(() => {
    if (logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [replay.state.log.length]);

  // Keyboard shortcuts: space = play/pause, left/right = step
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (mode !== "replay" || replay.state.events.length === 0) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (replay.state.playing) replay.pause();
        else replay.play();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        const next = Math.min(replay.state.currentIndex + 1, replay.state.events.length - 1);
        replay.seekTo(next);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const prev = Math.max(replay.state.currentIndex - 1, 0);
        replay.seekTo(prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, replay]);

  const startReplay = useCallback((id: string) => {
    replay.reset();
    setEngagementId(id);
    setMode("replay");
    replay.loadEvents(id, true);
  }, [replay]);

  const startLive = useCallback((id: string) => {
    replay.reset();
    setEngagementId(id);
    setMode("live");
    replay.goLive(id);
  }, [replay]);

  const stopLive = useCallback(() => {
    replay.stopLive();
    setMode("idle");
  }, [replay]);

  const copyMermaid = useCallback(() => {
    if (!data) return;
    navigator.clipboard.writeText(data.mermaid).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  const selectedActionOutputLines = selectedAction
    ? replay.state.outputLines.filter(
        (l) => l.action.toLowerCase() === selectedAction.name.toLowerCase(),
      )
    : [];

  const selectedActionEvents = selectedAction
    ? replay.state.log
        .filter((e) => e.event.source.toLowerCase() === selectedAction.name.toLowerCase())
        .map((e) => ({ time: new Date(e.event.createdAt).toISOString(), type: e.event.type, payload: e.event.payload, source: e.event.source }))
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

  const isReplaying = replay.state.currentIndex >= 0;
  const replayProgress = replay.state.events.length > 0
    ? ((replay.state.currentIndex + 1) / replay.state.events.length) * 100
    : 0;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-mono font-semibold">Playbook</h1>
            {data.available && data.available.length > 1 && (
              <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
                {data.available.map((pb) => (
                  <button
                    key={pb.key}
                    onClick={() => setPlaybookKey(pb.key)}
                    className={`font-mono text-[10px] px-2 py-0.5 rounded transition-colors ${
                      playbookKey === pb.key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {pb.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            {data.graph.nodes.length} actions, {data.graph.edges.length} connections
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Engagement selector (shared between replay and live) */}
          <EngagementSelector
            selected={engagementId}
            onSelect={(id) => {
              if (mode === "live") {
                startLive(id);
              } else {
                startReplay(id);
              }
            }}
          />

          {/* Mode controls */}
          <div className="flex items-center gap-1">
            {/* Replay controls */}
            {mode !== "live" && (
              <>
                {replay.state.loading ? (
                  <span className="px-2 py-1 text-[10px] font-mono text-muted-foreground animate-pulse">
                    Loading events...
                  </span>
                ) : (
                  <>
                    {!replay.state.playing ? (
                      <button
                        onClick={() => {
                          if (isReplaying) {
                            replay.play();
                          } else if (engagementId) {
                            startReplay(engagementId);
                          }
                        }}
                        disabled={!engagementId || (replay.state.currentIndex >= replay.state.events.length - 1 && isReplaying)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-pk-amber/10 text-pk-amber hover:bg-pk-amber/20 transition-colors disabled:opacity-40"
                      >
                        <Film className="size-3" />
                        {isReplaying ? "Resume" : "Replay"}
                      </button>
                    ) : (
                      <button
                        onClick={replay.pause}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-pk-amber/10 text-pk-amber hover:bg-pk-amber/20 transition-colors"
                      >
                        <Pause className="size-3" />
                        Pause
                      </button>
                    )}
                    {isReplaying && (
                      <button
                        onClick={() => {
                          replay.reset();
                          setMode("idle");
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <RotateCcw className="size-3" />
                        Reset
                      </button>
                    )}
                    {mode === "replay" && (
                      <div className="flex items-center gap-0.5 ml-1">
                        <Zap className="size-3 text-muted-foreground" />
                        {SPEED_OPTIONS.map((s) => (
                          <button
                            key={s}
                            onClick={() => replay.setSpeed(s)}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                              replay.state.speed === s
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
              </>
            )}

            {/* Live mode controls */}
            {mode === "live" ? (
              <div className="flex items-center gap-1">
                <span className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-red-500/10 text-red-400">
                  <Radio className="size-3 animate-pulse" />
                  Live
                  {replay.state.liveConnected ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 ml-0.5" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 ml-0.5" />
                  )}
                </span>
                <button
                  onClick={stopLive}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="size-3" />
                  Stop
                </button>
              </div>
            ) : (
              engagementId && (
                <button
                  onClick={() => startLive(engagementId)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <Radio className="size-3" />
                  Live
                </button>
              )
            )}
          </div>

          {/* Coverage toggle */}
          <button
            onClick={toggleCoverage}
            disabled={coverageLoading}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
              coverage
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-muted text-muted-foreground hover:text-foreground"
            } ${coverageLoading ? "animate-pulse" : ""}`}
          >
            <FlaskConical className="size-3" />
            {coverageLoading ? "Running..." : coverageSummary ? `${coverageSummary.passing}/${coverageSummary.total}` : "Tests"}
          </button>

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
            coverage={coverage ?? undefined}
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

      {/* Replay empty state */}
      {mode === "replay" && !replay.state.loading && replay.state.events.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-[11px] font-mono text-muted-foreground">
            No events recorded for this engagement. Events are captured when the supervisor runs a reactive playbook.
          </p>
        </div>
      )}

      {/* Replay progress bar + event log */}
      {mode === "replay" && isReplaying && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-3">
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
              <span>
                {replay.state.currentIndex + 1} / {replay.state.events.length} events
              </span>
              <span>
                {replay.state.log.length > 0
                  ? formatDuration(replay.state.log[replay.state.log.length - 1].time)
                  : "0s"}
                {replay.state.totalDuration > 0 && (
                  <span className="text-muted-foreground/50">
                    {" / "}{formatDuration(replay.state.totalDuration)}
                  </span>
                )}
              </span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-pk-amber rounded-full transition-all duration-200"
                style={{ width: `${replayProgress}%` }}
              />
            </div>
            {/* Clickable seek track */}
            <div
              className="h-3 cursor-pointer -mt-2 relative"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                const idx = Math.round(pct * (replay.state.events.length - 1));
                replay.seekTo(idx);
              }}
            />
          </div>

          {/* Event log */}
          <div>
            <h3 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              <span className="flex items-center gap-1.5">
                <Film className="size-3 text-pk-amber" />
                Replay Log
              </span>
            </h3>
            <div ref={logScrollRef} className="space-y-0.5 max-h-[200px] overflow-y-auto">
              {replay.state.log.map((entry, i) => (
                <button
                  key={i}
                  onClick={() => replay.seekTo(i)}
                  className={`flex items-baseline gap-2 text-[10px] font-mono w-full text-left hover:bg-muted/50 rounded px-1 -mx-1 ${
                    i === replay.state.log.length - 1 ? "text-pk-amber" : "text-muted-foreground"
                  }`}
                >
                  <span className="text-muted-foreground/50 tabular-nums shrink-0 w-[5ch] text-right">
                    {entry.time < 60
                      ? `${entry.time.toFixed(1)}s`
                      : `${Math.floor(entry.time / 60)}m${Math.floor(entry.time % 60)}s`}
                  </span>
                  <span className="font-semibold">{entry.event.type}</span>
                  <span className="text-muted-foreground/60 truncate">
                    {eventSummary(entry.event)}
                  </span>
                  <span className="text-muted-foreground/30 ml-auto shrink-0">
                    {entry.event.source}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Live event log (uses unified replay log with live indicator) */}
      {mode === "live" && replay.state.log.length > 0 && !isReplaying && (
        <div className="rounded-lg border border-border bg-card p-3">
          <h3 className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            <span className="flex items-center gap-1.5">
              <Radio className="size-3 text-red-400 animate-pulse" />
              Live Event Log
              <span className="text-muted-foreground/50 tabular-nums">{replay.state.log.length} events</span>
            </span>
          </h3>
          <div ref={logScrollRef} className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {replay.state.log.map((entry, i) => (
              <button
                key={i}
                onClick={() => replay.seekTo(i)}
                className={`flex items-baseline gap-2 text-[10px] font-mono w-full text-left hover:bg-muted/50 rounded px-1 -mx-1 ${
                  i === replay.state.log.length - 1 ? "text-pk-amber" : "text-muted-foreground"
                }`}
              >
                <span className="text-muted-foreground/50 tabular-nums shrink-0 w-[5ch] text-right">
                  {entry.time < 60
                    ? `${entry.time.toFixed(1)}s`
                    : `${Math.floor(entry.time / 60)}m${Math.floor(entry.time % 60)}s`}
                </span>
                <span className="font-semibold">{entry.event.type}</span>
                <span className="text-muted-foreground/60 truncate">
                  {eventSummary(entry.event)}
                </span>
                <span className="text-muted-foreground/30 ml-auto shrink-0">
                  {entry.event.source}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ActionDetail
        action={selectedAction}
        open={selectedAction !== null}
        onClose={() => setSelectedAction(null)}
        liveOutputLines={replay.state.live ? selectedActionOutputLines : undefined}
        liveEvents={replay.state.live ? selectedActionEvents : undefined}
        isLive={replay.state.live}
      />
    </div>
  );
}
