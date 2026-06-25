import {
  getEngagement,
  listActivity,
  listEvidence,
  listFindings,
  listTargets,
} from "@promptkiddie/core";
import { notFound } from "next/navigation";
import { Inbox } from "./inbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

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
            <span
              className={`
                inline-block px-2.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase tracking-wide
                ${active ? "bg-pk-green text-black" : ""}
                ${done ? "bg-muted text-muted-foreground" : ""}
                ${!done && !active ? "text-muted-foreground/40 border border-border/40" : ""}
              `}
            >
              {p}
            </span>
            {i < PHASES.length - 1 && (
              <span className="text-muted-foreground/30 text-xs">&rarr;</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default async function EngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const engagement = await getEngagement(id);
  if (!engagement) notFound();

  const [targets, findings, activity, evidence] = await Promise.all([
    listTargets(id),
    listFindings(id),
    listActivity(id),
    listEvidence(id),
  ]);

  const currentPhase = engagement.phase ?? "scoping";

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (f.severity in severityCounts)
      severityCounts[f.severity as keyof typeof severityCounts]++;
  }

  const inScopeCount = targets.filter((t) => t.inScope).length;

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold font-mono">{engagement.name}</h1>
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {engagement.type}
          </Badge>
          <Badge variant="secondary" className="font-mono text-[10px] uppercase">
            {engagement.status}
          </Badge>
        </div>
        <PhaseIndicator currentPhase={currentPhase} />
        {engagement.scope && (
          <p className="text-sm text-muted-foreground font-mono">
            {engagement.scope}
          </p>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Targets</p>
            <p className="text-2xl font-bold font-mono">{targets.length}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{inScopeCount} in scope</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Findings</p>
            <p className="text-2xl font-bold font-mono">{findings.length}</p>
          </CardContent>
        </Card>
        {(Object.entries(severityCounts) as [string, number][]).map(([sev, count]) => (
          <Card key={sev}>
            <CardContent className="p-4">
              <p className="text-[10px] font-mono uppercase text-muted-foreground">{sev}</p>
              <p className="text-2xl font-bold font-mono">{count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Targets */}
      <div id="targets">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">
              Targets <span className="text-muted-foreground">({targets.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono">No targets added</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase">Kind</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Identifier</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Scope</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targets.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">{t.kind}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-pk-green">{t.identifier}</TableCell>
                      <TableCell>
                        {t.inScope ? (
                          <Badge className="bg-pk-green/20 text-pk-green border-pk-green/30 font-mono text-[10px]">in</Badge>
                        ) : (
                          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">out</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">{t.notes ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Findings - detailed */}
      <div id="findings">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">
              Findings <span className="text-muted-foreground">({findings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono">No findings</p>
            ) : (
              findings.map((f) => (
                <div key={f.id} className="border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`font-mono text-[10px] ${severityColors[f.severity] ?? ""}`}>
                      {f.severity}
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {f.status}
                    </Badge>
                    {f.cvss != null && (
                      <span className="font-mono text-xs text-muted-foreground">
                        CVSS {f.cvss}
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(f.createdAt!).toLocaleString()}
                    </span>
                  </div>
                  <h4 className="font-mono text-sm font-semibold">{f.title}</h4>
                  {f.description && (
                    <p className="font-mono text-xs text-muted-foreground leading-relaxed">
                      {f.description}
                    </p>
                  )}
                  <div className="flex gap-4 flex-wrap">
                    {f.owasp && f.owasp.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">OWASP:</span>
                        {f.owasp.map((o) => (
                          <Badge key={o} variant="outline" className="font-mono text-[10px]">{o}</Badge>
                        ))}
                      </div>
                    )}
                    {f.attackTechniques && f.attackTechniques.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">ATT&CK:</span>
                        {f.attackTechniques.map((t) => (
                          <Badge key={t} variant="outline" className="font-mono text-[10px]">{t}</Badge>
                        ))}
                      </div>
                    )}
                    {f.cve && f.cve.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-muted-foreground">CVE:</span>
                        {f.cve.map((c) => (
                          <Badge key={c} variant="outline" className="font-mono text-[10px]">{c}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {f.remediation && (
                    <div className="border-t border-border pt-2 mt-2">
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">Remediation</span>
                      <p className="font-mono text-xs mt-1">{f.remediation}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity - commands prominent */}
      <div id="activity">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">
              Activity Log <span className="text-muted-foreground">({activity.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono">No activity</p>
            ) : (
              <div className="space-y-2">
                {activity.map((a) => (
                  <div key={a.id} className="border border-border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        {a.phase}
                      </Badge>
                      <span className="font-mono text-xs">{a.action}</span>
                      <span className="flex-1" />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {a.actor}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(a.createdAt!).toLocaleTimeString()}
                      </span>
                    </div>
                    {a.command && (
                      <div className="bg-background rounded px-3 py-2 mt-1 border border-border/50">
                        <code className="font-mono text-xs text-pk-green break-all">
                          $ {a.command}
                        </code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Evidence */}
      <div id="evidence">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">
              Evidence <span className="text-muted-foreground">({evidence.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono">No evidence captured</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Path</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">SHA256</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Size</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Captured</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidence.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">{e.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-pk-green">{e.path}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {e.sha256 ? e.sha256.slice(0, 16) + "..." : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.sizeBytes ? `${Math.round(e.sizeBytes / 1024)}KB` : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {new Date(e.capturedAt!).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Inbox */}
      <div id="inbox">
        <Inbox engagementId={id} />
      </div>
    </div>
  );
}
