import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageState, SectionLabel, PhaseText } from "@/components/pk";

interface SystemStatus {
  api: { ok: boolean; uptime: number };
  database: { ok: boolean; error?: string };
  docker: { ok: boolean; error?: string };
  containers: Array<{ name: string; image: string; status: string; created: string; engagementId?: string }>;
  agents: {
    running: number;
    total: number;
    runs: Array<{
      id: string; agent: string; phase: string; status: string;
      engagementId: string; engagementName?: string;
      startedAt: string; endedAt?: string;
    }>;
  };
  websockets: { connections: number };
}

function HealthDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />;
}

function AgentStatusDot({ status }: { status: string }) {
  if (status === "running") return <span className="inline-block w-2 h-2 rounded-full bg-pk-amber animate-pulse" />;
  if (status === "ok") return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-red-400" />;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function timeAgo(dateStr: string): string {
  const parsed = new Date(dateStr).getTime();
  if (Number.isNaN(parsed)) {
    // Docker format: "2026-07-20 10:50:40 +0200 CEST" - strip timezone name
    const cleaned = dateStr.replace(/\s+[A-Z]{2,5}$/, "");
    const retry = new Date(cleaned).getTime();
    if (Number.isNaN(retry)) return dateStr;
    const diff = (Date.now() - retry) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
  const diff = (Date.now() - parsed) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const MAX_AGENT_ROWS = 20;

export default function Status() {
  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery<SystemStatus>({
    queryKey: ["system-status"],
    queryFn: () => fetch("/api/status").then((r) => { if (!r.ok) throw new Error("API error"); return r.json(); }),
    refetchInterval: 10_000,
  });

  const lastCheck = dataUpdatedAt ? `${Math.floor((Date.now() - dataUpdatedAt) / 1000)}s ago` : null;

  return (
    <PageState isLoading={isLoading} isError={isError} refetch={refetch} label="system status">
      {data ? <StatusContent data={data} lastCheck={lastCheck} /> : null}
    </PageState>
  );
}

function StatusContent({ data, lastCheck }: { data: SystemStatus; lastCheck: string | null }) {
  const [showExited, setShowExited] = useState(false);
  const activeContainers = data.containers.filter(c => c.status.startsWith("Up"));
  const exitedContainers = data.containers.filter(c => !c.status.startsWith("Up"));
  const visibleContainers = showExited ? data.containers : activeContainers;
  const visibleRuns = data.agents.runs.slice(0, MAX_AGENT_ROWS);
  const hasMore = data.agents.runs.length > MAX_AGENT_ROWS;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold font-mono">Status</h1>
        {lastCheck && (
          <span className="text-xs font-mono text-muted-foreground">Last check: {lastCheck}</span>
        )}
      </div>

      {/* System health tiles */}
      <section>
        <SectionLabel>System Health</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="border border-border rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2">
              <HealthDot ok={data.api.ok} />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">API</span>
            </div>
            <div className="font-mono text-sm">{data.api.ok ? "ok" : "down"}</div>
            <div className="text-[10px] font-mono text-muted-foreground">{formatUptime(data.api.uptime)}</div>
          </div>

          <div className="border border-border rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2">
              <HealthDot ok={data.database.ok} />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Database</span>
            </div>
            <div className="font-mono text-sm">{data.database.ok ? "ok" : "error"}</div>
            {data.database.error && (
              <div className="text-[10px] font-mono text-destructive truncate" title={data.database.error}>{data.database.error}</div>
            )}
          </div>

          <div className="border border-border rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2">
              <HealthDot ok={data.docker.ok} />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Docker</span>
            </div>
            <div className="font-mono text-sm">{data.docker.ok ? "ok" : "unavailable"}</div>
            {data.docker.error && (
              <div className="text-[10px] font-mono text-destructive truncate" title={data.docker.error}>{data.docker.error}</div>
            )}
          </div>

          <div className="border border-border rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">WebSocket</span>
            </div>
            <div className="font-mono text-sm tabular-nums">{data.websockets.connections} conn</div>
          </div>
        </div>
      </section>

      {/* Containers */}
      <section>
        <div className="flex items-baseline gap-2">
          <SectionLabel>Containers ({activeContainers.length})</SectionLabel>
          {exitedContainers.length > 0 && (
            <button onClick={() => setShowExited(s => !s)} className="text-[9px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showExited ? "hide" : "show"} {exitedContainers.length} exited
            </button>
          )}
        </div>
        {visibleContainers.length === 0 ? (
          <div className="border border-border rounded-lg p-8 text-center">
            <p className="text-sm text-muted-foreground font-mono">No containers running</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Image</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleContainers.map((c) => (
                  <TableRow key={c.name} className="hover:bg-accent/50 transition-colors">
                    <TableCell className="font-mono text-sm text-pk-amber font-semibold">{c.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.image}</TableCell>
                    <TableCell className="font-mono text-xs">{c.status}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground text-right">{timeAgo(c.created)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Agent runs */}
      <section>
        <div className="flex items-baseline justify-between mb-2 pl-1">
          <SectionLabel>Agent Runs ({data.agents.total})</SectionLabel>
          {data.agents.running > 0 && (
            <span className="text-xs font-mono text-pk-amber tabular-nums">{data.agents.running} running</span>
          )}
        </div>
        {data.agents.runs.length === 0 ? (
          <div className="border border-border rounded-lg p-8 text-center">
            <p className="text-sm text-muted-foreground font-mono">No agent runs recorded</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[10px] uppercase">Agent</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Engagement</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Phase</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRuns.map((r) => (
                  <TableRow key={r.id} className="hover:bg-accent/50 transition-colors">
                    <TableCell className="font-mono text-sm font-semibold">{r.agent}</TableCell>
                    <TableCell>
                      <Link to={`/engagements/${r.engagementId}`} className="text-pk-amber hover:underline font-mono text-xs">
                        {r.engagementName ?? r.engagementId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell><PhaseText phase={r.phase} /></TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        <AgentStatusDot status={r.status} />
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground text-right tabular-nums">
                      {timeAgo(r.startedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {hasMore && (
              <div className="px-4 py-2 border-t border-border text-xs font-mono text-muted-foreground">
                Showing {MAX_AGENT_ROWS} of {data.agents.runs.length}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
