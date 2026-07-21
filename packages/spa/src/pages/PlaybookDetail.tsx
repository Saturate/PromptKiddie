import { useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { ActionGraphView } from "@/components/graph/action-graph";
import { ActionDetail, type ActionDetailData } from "@/components/graph/action-detail";
import type { ActionNodeData } from "@/components/graph/action-node";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, X, Play, Zap, ListOrdered, ChevronRight, RefreshCw } from "lucide-react";

interface ActionInfo {
  name: string;
  description?: string;
  kind: "script" | "agent" | "both";
  emits: string[];
  triggeredBy: string[];
}

interface PlaybookData {
  key: string;
  name: string;
  description: string;
  actions: ActionInfo[];
  graph: {
    nodes: Array<{ id: string; name: string; description?: string; kind: string; emits: string[] }>;
    edges: Array<{ from: string; to: string; event: string }>;
  };
}

interface SimStep {
  event: { type: string; payload: Record<string, unknown> };
  triggered: string[];
  timestamp: number;
}

type Tab = "graph" | "actions" | "simulate";
type SimMode = "fire" | "sequence";

const TABS: { value: Tab; label: string }[] = [
  { value: "graph", label: "Graph" },
  { value: "actions", label: "Actions" },
  { value: "simulate", label: "Simulate" },
];

const STANDARD_EVENTS = [
  "EngagementStarted",
  "PortDiscovered",
  "VersionIdentified",
  "HostnameFound",
  "FileDownloaded",
  "FindingAdded",
  "CredentialFound",
  "ShellObtained",
  "FlagCaptured",
  "ExploitAvailable",
  "PathDiscovered",
  "StallDetected",
];

const DEFAULT_PAYLOADS: Record<string, Record<string, unknown>> = {
  PortDiscovered: { port: 80, service: "http", version: "nginx 1.24.0" },
  VersionIdentified: { product: "nginx", version: "1.24.0" },
  HostnameFound: { hostname: "target.htb", source: "ssl_cert" },
  FindingAdded: { severity: "critical", title: "SQLi in /login" },
  CredentialFound: { username: "admin", password: "secret", source: "config" },
  ShellObtained: { user: "www-data", method: "rce" },
  PathDiscovered: { url: "http://target/admin", status: 200 },
  FlagCaptured: { type: "user", value: "flag{test}" },
  ExploitAvailable: { cve: "CVE-2025-0001", product: "test", cvss: 9.8 },
};

const KIND_COLORS: Record<string, string> = {
  script: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  agent: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  both: "text-purple-400 bg-purple-500/10 border-purple-500/20",
};

export default function PlaybookDetail() {
  const { key } = useParams<{ key: string }>();
  const { data, isLoading, isError, refetch } = useQuery<PlaybookData>({
    queryKey: ["playbook", key],
    queryFn: () => fetch(`/api/playbooks/catalog/${key}`).then((r) => { if (!r.ok) throw new Error("Failed to load playbook"); return r.json(); }),
    enabled: !!key,
  });
  const [tab, setTab] = useState<Tab>("graph");
  const [selectedAction, setSelectedAction] = useState<ActionDetailData | null>(null);

  const handleNodeClick = useCallback((_nodeId: string, nodeData: ActionNodeData) => {
    if (!data) return;
    const action = data.actions.find((a) => a.name === nodeData.name);
    if (!action) return;
    const triggers = data.graph.edges
      .filter((e) => e.from === action.name)
      .map((e) => e.to)
      .filter((v, i, a) => a.indexOf(v) === i);
    setSelectedAction({
      ...nodeData,
      id: action.name,
      triggeredBy: action.triggeredBy,
      triggers,
    });
  }, [data]);

  if (isLoading) return <div className="text-sm text-muted-foreground font-mono">Loading...</div>;
  if (isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive font-mono">Failed to load playbook.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
          <RefreshCw className="size-3 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }
  if (!data) return null;

  const graphWithState = {
    ...data.graph,
    nodes: data.graph.nodes.map((n) => ({
      ...n,
      running: 0,
      eventCount: 0,
    })),
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/playbooks" className="inline-flex items-center gap-1 text-xs text-muted-foreground font-mono hover:text-foreground mb-2">
          <ArrowLeft className="size-3" /> Playbooks
        </Link>
        <h1 className="text-xl font-bold font-mono">{data.name}</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">{data.description}</p>
        <div className="flex items-center gap-3 mt-2 text-[11px] font-mono text-muted-foreground">
          <span className="text-pk-amber font-semibold">{data.actions.length} actions</span>
          <span className="px-1.5 py-0.5 rounded bg-muted text-[9px]">built-in</span>
          <span className="px-1.5 py-0.5 rounded bg-muted text-[9px]">read-only</span>
        </div>
      </div>

      <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 w-fit">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
              tab === t.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "graph" && (
        <div className="h-[calc(100vh-280px)]">
          <ReactFlowProvider>
            <ActionGraphView
              graph={graphWithState}
              onNodeClick={handleNodeClick}
              className="!h-full"
            />
          </ReactFlowProvider>
          <ActionDetail
            action={selectedAction}
            open={!!selectedAction}
            onClose={() => setSelectedAction(null)}
          />
        </div>
      )}

      {tab === "actions" && <ActionsTable actions={data.actions} />}
      {tab === "simulate" && <SimulatePanel playbookKey={key!} actions={data.actions} />}
    </div>
  );
}

function ActionsTable({ actions }: { actions: ActionInfo[] }) {
  const sorted = [...actions].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="rounded-lg border border-border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
            <TableHead className="font-mono text-[10px] uppercase">Description</TableHead>
            <TableHead className="font-mono text-[10px] uppercase">Kind</TableHead>
            <TableHead className="font-mono text-[10px] uppercase">Emits</TableHead>
            <TableHead className="font-mono text-[10px] uppercase">Triggered By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((a) => (
            <TableRow key={a.name} className="hover:bg-accent/50 transition-colors">
              <TableCell className="font-mono text-xs font-semibold text-pk-amber whitespace-nowrap">{a.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground max-w-[300px]">{a.description ?? "-"}</TableCell>
              <TableCell>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${KIND_COLORS[a.kind] ?? ""}`}>
                  {a.kind}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {a.emits.map((e) => (
                    <span key={e} className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                      {e}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {a.triggeredBy.map((e) => (
                    <span key={e} className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                      {e}
                    </span>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SimulatePanel({ playbookKey, actions }: { playbookKey: string; actions: ActionInfo[] }) {
  const [mode, setMode] = useState<SimMode>("fire");
  const [eventType, setEventType] = useState(STANDARD_EVENTS[0]);
  const [payload, setPayload] = useState(JSON.stringify(DEFAULT_PAYLOADS[STANDARD_EVENTS[0]] ?? {}, null, 2));
  const [fireResult, setFireResult] = useState<string[] | null>(null);
  const [queue, setQueue] = useState<Array<{ type: string; payload: Record<string, unknown> }>>([]);
  const [seqResults, setSeqResults] = useState<SimStep[] | null>(null);
  const [simulating, setSimulating] = useState(false);

  const updateEventType = (type: string) => {
    setEventType(type);
    setPayload(JSON.stringify(DEFAULT_PAYLOADS[type] ?? {}, null, 2));
  };

  const parsePayload = (): Record<string, unknown> => {
    try { return JSON.parse(payload); }
    catch { return {}; }
  };

  const handleFire = async () => {
    setSimulating(true);
    try {
      const res = await fetch(`/api/playbooks/catalog/${playbookKey}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: [{ type: eventType, payload: parsePayload() }] }),
      });
      if (!res.ok) throw new Error("Simulation failed");
      const data = await res.json();
      setFireResult(data.steps?.[0]?.triggered ?? []);
    } catch {
      setFireResult([]);
    }
    setSimulating(false);
  };

  const addToQueue = () => {
    setQueue((q) => [...q, { type: eventType, payload: parsePayload() }]);
  };

  const removeFromQueue = (idx: number) => {
    setQueue((q) => q.filter((_, i) => i !== idx));
  };

  const handleSimulateAll = async () => {
    if (queue.length === 0) return;
    setSimulating(true);
    try {
      const res = await fetch(`/api/playbooks/catalog/${playbookKey}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: queue }),
      });
      if (!res.ok) throw new Error("Simulation failed");
      const data = await res.json();
      setSeqResults(data.steps ?? []);
    } catch {
      setSeqResults([]);
    }
    setSimulating(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 w-fit">
        <button
          onClick={() => setMode("fire")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
            mode === "fire" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="size-3" /> Fire
        </button>
        <button
          onClick={() => setMode("sequence")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
            mode === "sequence" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ListOrdered className="size-3" /> Sequence
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Event controls */}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">Event Type</label>
            <select
              value={eventType}
              onChange={(e) => updateEventType(e.target.value)}
              className="w-full bg-background border border-border rounded px-2 py-1.5 font-mono text-sm"
            >
              {STANDARD_EVENTS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block mb-1">Payload</label>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              rows={6}
              className="w-full bg-background border border-border rounded px-3 py-2 font-mono text-xs resize-none"
              spellCheck={false}
            />
          </div>

          {mode === "fire" ? (
            <Button
              onClick={handleFire}
              disabled={simulating}
              className="font-mono text-xs"
              size="sm"
            >
              <Zap className="size-3 mr-1.5" />
              {simulating ? "Firing..." : "Fire Event"}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button onClick={addToQueue} variant="outline" size="sm" className="font-mono text-xs">
                Add to Queue
              </Button>
              <Button
                onClick={handleSimulateAll}
                disabled={simulating || queue.length === 0}
                size="sm"
                className="font-mono text-xs"
              >
                <Play className="size-3 mr-1.5" />
                {simulating ? "Simulating..." : `Simulate ${queue.length} event${queue.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          )}

          {/* Sequence mode: event queue */}
          {mode === "sequence" && queue.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Event Queue</label>
                <button
                  onClick={() => setQueue([])}
                  className="text-[10px] text-muted-foreground hover:text-foreground font-mono"
                >
                  clear
                </button>
              </div>
              <div className="space-y-1 rounded-lg border border-border bg-background p-2">
                {queue.map((evt, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-muted-foreground/50 tabular-nums w-4">{i + 1}</span>
                    <span className="text-pk-amber font-semibold">{evt.type}</span>
                    <span className="text-muted-foreground/60 truncate flex-1 text-[10px]">
                      {JSON.stringify(evt.payload)}
                    </span>
                    <button onClick={() => removeFromQueue(i)} className="text-muted-foreground hover:text-foreground shrink-0">
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Results */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Results</label>
            {(fireResult || seqResults) && (
              <button
                onClick={() => { setFireResult(null); setSeqResults(null); }}
                className="text-[10px] text-muted-foreground hover:text-foreground font-mono"
              >
                clear
              </button>
            )}
          </div>

          {mode === "fire" && fireResult !== null && (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-pk-amber/10 text-pk-amber border border-pk-amber/20 font-mono font-semibold">
                  {eventType}
                </span>
                <ChevronRight className="size-3 text-muted-foreground" />
                {fireResult.length > 0 ? (
                  <span className="text-xs font-mono text-foreground">
                    {fireResult.length} action{fireResult.length !== 1 ? "s" : ""} triggered
                  </span>
                ) : (
                  <span className="text-xs font-mono text-muted-foreground">no match</span>
                )}
              </div>
              {fireResult.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {fireResult.map((name) => {
                    const action = actions.find((a) => a.name === name);
                    const kindColor = action ? KIND_COLORS[action.kind] ?? "" : "";
                    return (
                      <span key={name} className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${kindColor || "bg-muted text-foreground"}`}>
                        {name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {mode === "sequence" && seqResults !== null && (
            <div className="space-y-2">
              {seqResults.map((step, i) => (
                <div key={i} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-muted-foreground/50 tabular-nums text-[10px] font-mono w-4">{i + 1}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-pk-amber/10 text-pk-amber border border-pk-amber/20 font-mono font-semibold">
                      {step.event.type}
                    </span>
                    <ChevronRight className="size-3 text-muted-foreground" />
                    {step.triggered.length > 0 ? (
                      <span className="text-[10px] font-mono text-foreground">
                        {step.triggered.length} triggered
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-muted-foreground">no match</span>
                    )}
                  </div>
                  {step.triggered.length > 0 && (
                    <div className="flex flex-wrap gap-1 ml-6">
                      {step.triggered.map((name) => {
                        const action = actions.find((a) => a.name === name);
                        const kindColor = action ? KIND_COLORS[action.kind] ?? "" : "";
                        return (
                          <span key={name} className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${kindColor || "bg-muted text-foreground"}`}>
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!fireResult && !seqResults && (
            <div className="rounded-lg border border-border/50 border-dashed bg-background/50 p-6 text-center">
              <p className="text-xs text-muted-foreground font-mono">
                {mode === "fire"
                  ? "Pick an event and hit Fire to see which actions trigger."
                  : "Build an event queue and hit Simulate to trace the chain."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
