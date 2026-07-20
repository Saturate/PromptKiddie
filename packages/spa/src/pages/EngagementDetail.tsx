import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEngagement, useTargets, useFindings, useActivity,
  useEvidence, useObjectives,
} from "@/hooks/use-api";
import { setEngagementStatus } from "@/api/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileDown, Play, Pause, Square, RotateCcw } from "lucide-react";
import { StatusDot, PhaseText, SeverityBadge, PageState, SectionLabel } from "@/components/pk";

const DEFAULT_PHASES = ["scoping", "recon", "enum", "exploit", "postexploit", "report"];

function PhaseIndicator({ currentPhase, phases }: { currentPhase: string; phases?: string[] }) {
  const list = phases ?? DEFAULT_PHASES;
  const activeIdx = list.indexOf(currentPhase);

  if (activeIdx === -1) {
    return (
      <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase tracking-wide bg-pk-amber text-black">
        {currentPhase}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {list.map((p, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={p} className="flex items-center gap-1">
            <span className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase tracking-wide ${active ? "bg-pk-amber text-black" : ""} ${done ? "bg-muted text-muted-foreground" : ""} ${!done && !active ? "text-muted-foreground/40 border border-border/40" : ""}`}>
              {p}
            </span>
            {i < list.length - 1 && <span className="text-muted-foreground/30 text-xs">&rarr;</span>}
          </div>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const SEV_BORDER: Record<string, string> = {
  critical: "border-l-severity-critical",
  high: "border-l-severity-high",
  medium: "border-l-severity-medium",
  low: "border-l-severity-low",
  info: "border-l-severity-info",
};

function EngagementControls({ id, status }: { id: string; status: string }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const changeStatus = async (newStatus: string) => {
    setLoading(true);
    try {
      await setEngagementStatus(id, newStatus);
      queryClient.invalidateQueries({ queryKey: ["engagement", id] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {(status === "created" || status === "scoping") && (
        <Button size="sm" onClick={() => changeStatus("active")} disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs">
          <Play className="size-3 mr-1" /> Start
        </Button>
      )}
      {status === "active" && (
        <>
          <Button size="sm" variant="outline" onClick={() => changeStatus("paused")} disabled={loading}
            className="font-mono text-xs">
            <Pause className="size-3 mr-1" /> Pause
          </Button>
          <Button size="sm" variant="outline" onClick={() => changeStatus("done")} disabled={loading}
            className="font-mono text-xs text-destructive border-destructive/30 hover:bg-destructive/10">
            <Square className="size-3 mr-1" /> Stop
          </Button>
        </>
      )}
      {status === "paused" && (
        <>
          <Button size="sm" onClick={() => changeStatus("active")} disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs">
            <Play className="size-3 mr-1" /> Resume
          </Button>
          <Button size="sm" variant="outline" onClick={() => changeStatus("done")} disabled={loading}
            className="font-mono text-xs text-destructive border-destructive/30 hover:bg-destructive/10">
            <Square className="size-3 mr-1" /> Stop
          </Button>
        </>
      )}
      {(status === "done" || status === "reporting") && (
        <Button size="sm" variant="outline" onClick={() => changeStatus("active")} disabled={loading}
          className="font-mono text-xs">
          <RotateCcw className="size-3 mr-1" /> Reopen
        </Button>
      )}
    </div>
  );
}

export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: engagement, isLoading, isError, refetch } = useEngagement(id);
  const { data: targets = [] } = useTargets(id) as { data: Any[] };
  const { data: findings = [] } = useFindings(id) as { data: Any[] };
  const { data: activity = [] } = useActivity(id) as { data: Any[] };
  const { data: objectives = [] } = useObjectives(id) as { data: Any[] };

  return (
    <PageState isLoading={isLoading} isError={isError} refetch={refetch} label="engagement">
      {engagement ? <EngagementContent eng={engagement as Any} targets={targets} findings={findings} activity={activity} objectives={objectives} id={id!} /> : (
        <div className="text-muted-foreground font-mono">Engagement not found.</div>
      )}
    </PageState>
  );
}

function EngagementContent({ eng, targets, findings, activity, objectives, id }: {
  eng: Any; targets: Any[]; findings: Any[]; activity: Any[]; objectives: Any[]; id: string;
}) {
  const currentPhase = eng.phase ?? "scoping";
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (f.severity in severityCounts) severityCounts[f.severity as keyof typeof severityCounts]++;
  }
  const inScopeCount = targets.filter((t: Any) => t.inScope).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold font-mono">{eng.name}</h1>
          <span className="font-mono text-xs text-muted-foreground">{eng.type}</span>
          <StatusDot status={eng.status} />
          <EngagementControls id={id} status={eng.status} />
          <span className="flex-1" />
          <a href={`/api/report/${id}`} download>
            <Button variant="outline" size="sm" className="font-mono text-xs"><FileDown className="size-3.5 mr-1.5" />Report</Button>
          </a>
        </div>
        <PhaseIndicator currentPhase={currentPhase} />
        {eng.scope && <p className="text-sm text-muted-foreground font-mono">{eng.scope}</p>}
      </div>

      {/* Brief */}
      {eng.brief && (
        <section>
          <SectionLabel>Brief</SectionLabel>
          <div className="border border-border rounded-lg p-4">
            <p className="font-mono text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{eng.brief}</p>
          </div>
        </section>
      )}

      {/* CTF flag progress */}
      {eng.type === "ctf" && objectives.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-pk-amber transition-all" style={{ width: `${(objectives.filter((o: Any) => o.completed).length / objectives.length) * 100}%` }} />
          </div>
          <span className="font-mono text-sm font-bold text-pk-amber tabular-nums">{objectives.filter((o: Any) => o.completed).length}/{objectives.length} flags</span>
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Targets</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{targets.length}</div>
          <div className="text-[10px] font-mono text-pk-amber">{inScopeCount} in scope</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Findings</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{findings.length}</div>
        </div>
        {(Object.entries(severityCounts) as [string, number][]).map(([sev, count]) => (
          <div key={sev} className="bg-card border border-border rounded-lg p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{sev}</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{count}</div>
          </div>
        ))}
      </div>

      {/* Targets table */}
      <section>
        <SectionLabel>Targets ({targets.length})</SectionLabel>
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground font-mono py-6 text-center">No targets added</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="font-mono text-[10px] uppercase">Kind</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Identifier</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Scope</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Notes</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {targets.map((t: Any) => (
                  <TableRow key={t.id} className="hover:bg-accent/50 transition-colors">
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.kind}</TableCell>
                    <TableCell className="font-mono text-sm text-pk-amber font-semibold">{t.identifier}</TableCell>
                    <TableCell>
                      {t.inScope ? (
                        <span className="text-[10px] font-mono text-pk-amber">in</span>
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground/50">out</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">{t.notes ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Findings */}
      <section>
        <SectionLabel>Findings ({findings.length})</SectionLabel>
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground font-mono py-6 text-center">No findings</p>
        ) : (
          <div className="space-y-2">
            {findings.map((f: Any) => (
              <div key={f.id} className={`border border-border border-l-2 ${SEV_BORDER[f.severity] ?? "border-l-zinc-500"} rounded-lg p-3 hover:bg-accent/30 transition-colors`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <SeverityBadge severity={f.severity} />
                  <span className="font-mono text-xs text-muted-foreground">{f.status}</span>
                  {f.cvss != null && <span className="font-mono text-xs text-muted-foreground tabular-nums">CVSS {f.cvss}</span>}
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-muted-foreground/60">{new Date(f.createdAt).toLocaleString()}</span>
                </div>
                <h4 className="font-mono text-sm font-semibold mt-1.5">{f.title}</h4>
                {f.description && <p className="font-mono text-xs text-muted-foreground leading-relaxed mt-1 line-clamp-2">{f.description}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Activity log */}
      <section>
        <SectionLabel>Activity ({activity.length})</SectionLabel>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground font-mono">No activity</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
            {activity.map((a: Any) => (
              <div key={a.id} className="px-3 py-2 hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0"><PhaseText phase={a.phase} /></span>
                  <span className="font-mono text-xs truncate flex-1">{a.action}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60 shrink-0">{a.actor}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{new Date(a.createdAt).toLocaleTimeString()}</span>
                </div>
                {a.command && (
                  <div className="mt-1 ml-20 pl-3 border-l border-border/50">
                    <code className="font-mono text-xs text-pk-amber/70">$ {a.command}</code>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
