import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchEngagement, fetchTargets, fetchFindings, fetchActivity,
  fetchEvidence, fetchObjectives,
} from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileDown } from "lucide-react";

const PHASES = ["scoping", "recon", "enum", "exploit", "postexploit", "report"] as const;

const severityColors: Record<string, string> = {
  critical: "bg-severity-critical text-white",
  high: "bg-severity-high text-black",
  medium: "bg-severity-medium text-black",
  low: "bg-severity-low text-white",
  info: "bg-severity-info text-white",
};

function PhaseIndicator({ currentPhase }: { currentPhase: string }) {
  const activeIdx = PHASES.indexOf(currentPhase as (typeof PHASES)[number]);
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {PHASES.map((p, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={p} className="flex items-center gap-1">
            <span className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase tracking-wide ${active ? "bg-pk-amber text-black" : ""} ${done ? "bg-muted text-muted-foreground" : ""} ${!done && !active ? "text-muted-foreground/40 border border-border/40" : ""}`}>
              {p}
            </span>
            {i < PHASES.length - 1 && <span className="text-muted-foreground/30 text-xs">&rarr;</span>}
          </div>
        );
      })}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{
    engagement: Any; targets: Any[]; findings: Any[]; activity: Any[];
    evidence: Any[]; objectives: Any[];
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [engagement, targets, findings, activity, evidence, objectives] = await Promise.all([
        fetchEngagement(id), fetchTargets(id), fetchFindings(id),
        fetchActivity(id), fetchEvidence(id), fetchObjectives(id),
      ]);
      setData({ engagement, targets, findings, activity, evidence, objectives });
    })();
  }, [id]);

  if (!data) return <div className="p-6 text-muted-foreground font-mono">Loading...</div>;

  const { engagement, targets, findings, activity, objectives } = data;
  if (!engagement) return <div className="p-6 text-muted-foreground font-mono">Engagement not found.</div>;

  const currentPhase = engagement.phase ?? "scoping";
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (f.severity in severityCounts) severityCounts[f.severity as keyof typeof severityCounts]++;
  }
  const inScopeCount = targets.filter((t: Any) => t.inScope).length;

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold font-mono">{engagement.name}</h1>
          <Badge variant="outline" className="font-mono text-[10px] uppercase">{engagement.type}</Badge>
          <Badge variant="secondary" className="font-mono text-[10px] uppercase">{engagement.status}</Badge>
          <span className="flex-1" />
          <a href={`/api/report/${id}`} download>
            <Button variant="outline" size="sm"><FileDown className="size-3.5" />Download Report</Button>
          </a>
        </div>
        <PhaseIndicator currentPhase={currentPhase} />
        {engagement.scope && <p className="text-sm text-muted-foreground font-mono">{engagement.scope}</p>}
      </div>

      {engagement.brief && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-mono">Brief</CardTitle></CardHeader>
          <CardContent><p className="font-mono text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{engagement.brief}</p></CardContent>
        </Card>
      )}

      {engagement.type === "ctf" && objectives.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-pk-amber transition-all" style={{ width: `${(objectives.filter((o: Any) => o.completed).length / objectives.length) * 100}%` }} />
          </div>
          <span className="font-mono text-sm font-bold text-pk-amber">{objectives.filter((o: Any) => o.completed).length}/{objectives.length} flags</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Targets</p><p className="text-2xl font-bold font-mono">{targets.length}</p><p className="text-[10px] text-muted-foreground font-mono">{inScopeCount} in scope</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Findings</p><p className="text-2xl font-bold font-mono">{findings.length}</p></CardContent></Card>
        {(Object.entries(severityCounts) as [string, number][]).map(([sev, count]) => (
          <Card key={sev}><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">{sev}</p><p className="text-2xl font-bold font-mono">{count}</p></CardContent></Card>
        ))}
      </div>

      <div id="targets">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-mono">Targets ({targets.length})</CardTitle></CardHeader>
          <CardContent>
            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono text-center py-6">No targets added</p>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="font-mono text-[10px] uppercase">Kind</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Identifier</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Scope</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Notes</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {targets.map((t: Any) => (
                    <TableRow key={t.id}>
                      <TableCell><Badge variant="outline" className="font-mono text-[10px]">{t.kind}</Badge></TableCell>
                      <TableCell className="font-mono text-sm text-pk-amber">{t.identifier}</TableCell>
                      <TableCell>{t.inScope ? <Badge className="bg-pk-amber/20 text-pk-amber border-pk-amber/30 font-mono text-[10px]">in</Badge> : <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">out</Badge>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">{t.notes ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div id="findings">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-mono">Findings ({findings.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono text-center py-6">No findings</p>
            ) : findings.map((f: Any) => (
              <div key={f.id} className="border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`font-mono text-[10px] ${severityColors[f.severity] ?? ""}`}>{f.severity}</Badge>
                  <Badge variant="secondary" className="font-mono text-[10px]">{f.status}</Badge>
                  {f.cvss != null && <span className="font-mono text-xs text-muted-foreground">CVSS {f.cvss}</span>}
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</span>
                </div>
                <h4 className="font-mono text-sm font-semibold">{f.title}</h4>
                {f.description && <p className="font-mono text-xs text-muted-foreground leading-relaxed">{f.description}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div id="activity">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-mono">Activity Log ({activity.length})</CardTitle></CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono">No activity</p>
            ) : (
              <div className="space-y-2">
                {activity.map((a: Any) => (
                  <div key={a.id} className="border border-border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">{a.phase}</Badge>
                      <span className="font-mono text-xs">{a.action}</span>
                      <span className="flex-1" />
                      <span className="font-mono text-[10px] text-muted-foreground">{a.actor}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{new Date(a.createdAt).toLocaleTimeString()}</span>
                    </div>
                    {a.command && (
                      <div className="bg-background rounded px-3 py-2 mt-1 border border-border/50">
                        <code className="font-mono text-xs text-pk-amber break-all">$ {a.command}</code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
