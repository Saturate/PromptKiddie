import { AutoRefresh } from "@/components/auto-refresh";
import {
  getEngagement,
  listActivity,
  listAgentLog,
  listAgentRuns,
  listEvidence,
  listFindings,
  listObjectives,
  listTargets,
  listEngagementSteps,
  getPlaybook,
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
import { Button } from "@/components/ui/button";
import { FileDown } from "lucide-react";

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
                ${active ? "bg-pk-amber text-black" : ""}
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

  const [targets, findings, activity, evidence, agentRuns, objectives, agentLogEntries, steps] = await Promise.all([
    listTargets(id),
    listFindings(id),
    listActivity(id),
    listEvidence(id),
    listAgentRuns(id),
    listObjectives(id),
    listAgentLog(id),
    listEngagementSteps(id),
  ]);

  const hasRunningAgent = agentRuns.some((r) => r.status === "running");

  const currentPhase = engagement.phase ?? "scoping";

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (f.severity in severityCounts)
      severityCounts[f.severity as keyof typeof severityCounts]++;
  }

  const inScopeCount = targets.filter((t) => t.inScope).length;

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <AutoRefresh interval={5000} />
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold font-mono">{engagement.name}</h1>
          {hasRunningAgent && (
            <span className="h-2.5 w-2.5 rounded-full bg-pk-amber animate-pulse" title="Agent running" />
          )}
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {engagement.type}
          </Badge>
          <Badge variant="secondary" className="font-mono text-[10px] uppercase">
            {engagement.status}
          </Badge>
          <span className="flex-1" />
          <a href={`/api/report/${id}`} download>
            <Button variant="outline" size="sm">
              <FileDown className="size-3.5" data-icon="inline-start" />
              Download Report
            </Button>
          </a>
        </div>
        <PhaseIndicator currentPhase={currentPhase} />
        {engagement.sourceUrl && (
          <a
            href={engagement.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-mono text-pk-amber hover:underline"
          >
            {engagement.sourceUrl} <span className="text-muted-foreground">&#8599;</span>
          </a>
        )}
        {engagement.scope && (
          <p className="text-sm text-muted-foreground font-mono">
            {engagement.scope}
          </p>
        )}
      </div>

      {/* Brief */}
      {engagement.brief && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">Brief</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
              {engagement.brief}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Playbook checklist */}
      {steps.length > 0 && (() => {
        const phases = [...new Set(steps.map((s) => s.phase))];
        const doneCount = steps.filter((s) => s.status === "done").length;
        const skippedCount = steps.filter((s) => s.status === "skipped").length;
        const totalCount = steps.length;
        const pct = Math.round((doneCount / totalCount) * 100);
        return (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-mono">
                  Playbook <span className="text-muted-foreground">({doneCount}/{totalCount} done{skippedCount ? `, ${skippedCount} skipped` : ""})</span>
                </CardTitle>
                <span className="font-mono text-xs text-pk-amber font-bold">{pct}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                <div className="h-full bg-pk-amber transition-all" style={{ width: `${pct}%` }} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {phases.map((phaseName) => {
                  const phaseSteps = steps.filter((s) => s.phase === phaseName);
                  const phaseDone = phaseSteps.filter((s) => s.status === "done" || s.status === "skipped").length;
                  const isCurrentPhase = phaseName === currentPhase;
                  return (
                    <div key={phaseName}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`font-mono text-[10px] uppercase tracking-wider font-semibold ${isCurrentPhase ? "text-pk-amber" : "text-muted-foreground"}`}>
                          {phaseName}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {phaseDone}/{phaseSteps.length}
                        </span>
                        {isCurrentPhase && <span className="h-1.5 w-1.5 rounded-full bg-pk-amber animate-pulse" />}
                      </div>
                      <div className="space-y-1 ml-1">
                        {phaseSteps.map((step) => (
                          <div
                            key={step.id}
                            className={`flex items-start gap-2 py-1 px-2 rounded text-xs font-mono ${
                              step.status === "done" ? "text-muted-foreground" :
                              step.status === "skipped" ? "text-muted-foreground/50 line-through" :
                              isCurrentPhase ? "text-foreground" : "text-muted-foreground/60"
                            }`}
                          >
                            <span className="mt-0.5 shrink-0">
                              {step.status === "done" ? (
                                <span className="text-emerald-400">&#10003;</span>
                              ) : step.status === "skipped" ? (
                                <span className="text-muted-foreground/40">&#8212;</span>
                              ) : step.status === "running" ? (
                                <span className="text-pk-amber animate-pulse">&#9679;</span>
                              ) : (
                                <span className="text-muted-foreground/30">&#9675;</span>
                              )}
                            </span>
                            <span className="flex-1">{step.title}</span>
                            {step.skipReason && (
                              <span className="text-[9px] text-muted-foreground/40 italic truncate max-w-[150px]" title={step.skipReason}>
                                {step.skipReason}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Flag progress - CTF only */}
      {engagement.type === "ctf" && objectives.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-pk-amber transition-all"
              style={{ width: `${(objectives.filter(o => o.completed).length / objectives.length) * 100}%` }}
            />
          </div>
          <span className="font-mono text-sm font-bold text-pk-amber">
            {objectives.filter(o => o.completed).length}/{objectives.length} flags
          </span>
        </div>
      )}

      {/* Objectives / CTF Tasks */}
      {objectives.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">
              Objectives <span className="text-muted-foreground">({objectives.filter(o => o.completed).length}/{objectives.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {objectives.map((o) => (
                <div key={o.id} className="flex items-start gap-3 border border-border rounded-lg p-3">
                  <div className="mt-0.5 text-lg">
                    {o.completed ? (
                      <span className="text-pk-amber">&#10003;</span>
                    ) : (
                      <span className="text-muted-foreground/40">&#9675;</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">Task {o.taskNumber}</Badge>
                      <span className="font-mono text-sm font-medium">{o.title}</span>
                    </div>
                    {o.description && (
                      <p className="font-mono text-xs text-muted-foreground line-clamp-2">{o.description}</p>
                    )}
                    {o.flagFormat && (
                      <p className="font-mono text-[10px] text-muted-foreground">Format: {o.flagFormat}</p>
                    )}
                    <div className="font-mono text-xs">
                      {o.flag ? (
                        <span className="text-pk-amber font-semibold">{o.flag}</span>
                      ) : (
                        <span className="text-muted-foreground/50">---</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Severity Distribution - pentest types only */}
      {engagement.type !== "ctf" && findings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">Severity Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-4 rounded-full overflow-hidden">
              {(["critical", "high", "medium", "low", "info"] as const).map(sev => {
                const count = severityCounts[sev];
                if (count === 0) return null;
                const pct = (count / findings.length) * 100;
                const colors: Record<string, string> = {
                  critical: "bg-red-600", high: "bg-orange-500", medium: "bg-yellow-500",
                  low: "bg-blue-500", info: "bg-gray-500"
                };
                return (
                  <div
                    key={sev}
                    className={`${colors[sev]} transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${sev}: ${count} (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>
            <div className="flex gap-4 mt-2 flex-wrap">
              {(["critical", "high", "medium", "low", "info"] as const).map(sev => {
                if (severityCounts[sev] === 0) return null;
                const dotColors: Record<string, string> = {
                  critical: "bg-red-600", high: "bg-orange-500", medium: "bg-yellow-500",
                  low: "bg-blue-500", info: "bg-gray-500"
                };
                return (
                  <span key={sev} className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                    <span className={`w-2 h-2 rounded-full ${dotColors[sev]}`} />
                    {sev} ({severityCounts[sev]})
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
              <div className="text-center py-6 space-y-1">
                <p className="text-sm text-muted-foreground font-mono">No targets added</p>
                <p className="text-xs text-primary/40 italic font-mono">hard to hack nothing</p>
              </div>
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
                      <TableCell className="font-mono text-sm text-pk-amber">{t.identifier}</TableCell>
                      <TableCell>
                        {t.inScope ? (
                          <Badge className="bg-pk-amber/20 text-pk-amber border-pk-amber/30 font-mono text-[10px]">in</Badge>
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
              <div className="text-center py-6 space-y-1">
                <p className="text-sm text-muted-foreground font-mono">No findings</p>
                <p className="text-xs text-primary/40 italic font-mono">either it&apos;s secure or we haven&apos;t looked hard enough</p>
              </div>
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
                  {f.remediation ? (
                    <div className="border-t border-border pt-2 mt-2">
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">Remediation</span>
                      <p className="font-mono text-xs mt-1">{f.remediation}</p>
                    </div>
                  ) : engagement.type !== "ctf" && (
                    <div className="border-t border-border pt-2 mt-2">
                      <span className="font-mono text-[10px] text-muted-foreground/50 uppercase">No remediation noted</span>
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
                        <code className="font-mono text-xs text-pk-amber break-all">
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

      {/* Agent Log */}
      <div id="agent-log">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">
              Agent Log <span className="text-muted-foreground">({agentLogEntries.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {agentLogEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono">No agent reasoning logged</p>
            ) : (
              agentLogEntries.map((entry) => {
                const catColors: Record<string, string> = {
                  hypothesis: "border-l-purple-500",
                  decision: "border-l-blue-500",
                  observation: "border-l-gray-500",
                  stuck: "border-l-red-500",
                  progress: "border-l-green-500",
                };
                const catBadgeColors: Record<string, string> = {
                  hypothesis: "bg-purple-500/20 text-purple-400",
                  decision: "bg-blue-500/20 text-blue-400",
                  observation: "bg-gray-500/20 text-gray-400",
                  stuck: "bg-red-500/20 text-red-400",
                  progress: "bg-emerald-500/20 text-emerald-400",
                };
                const borderClass = entry.category ? catColors[entry.category] ?? "border-l-gray-500" : "border-l-gray-500";
                return (
                  <div
                    key={entry.id}
                    className={`border-l-2 ${borderClass} bg-muted/30 rounded-r-lg p-3 space-y-1`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {entry.agent}
                      </Badge>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {entry.phase}
                      </Badge>
                      {entry.category && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${catBadgeColors[entry.category] ?? ""}`}>
                          {entry.category}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                        {new Date(entry.createdAt!).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm font-mono whitespace-pre-wrap">{entry.message}</p>
                  </div>
                );
              })
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
              <div className="text-center py-6 space-y-1">
                <p className="text-sm text-muted-foreground font-mono">No evidence captured</p>
                <p className="text-xs text-primary/40 italic font-mono">screenshots or it didn&apos;t happen</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Path</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">SHA256</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Size</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Captured</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evidence.map((e) => {
                    const isImage = e.path?.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
                    const isText = e.path?.match(/\.(txt|json|jsonl|log|xml|csv|html)$/i);
                    return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">{e.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <span className="relative group/ev inline-block">
                          <a
                            href={`/api/evidence/${e.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pk-amber hover:underline"
                          >
                            {e.path?.split("/").pop()}
                          </a>
                          {isImage && (
                            <span className="pointer-events-none absolute left-0 top-full mt-2 z-50 hidden group-hover/ev:block">
                              <img
                                src={`/api/evidence/${e.id}`}
                                alt={e.path?.split("/").pop() ?? ""}
                                className="rounded-lg border border-border shadow-xl max-w-[400px] max-h-[300px] object-contain bg-background"
                                loading="lazy"
                              />
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {e.sha256 ? e.sha256.slice(0, 16) + "..." : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.sizeBytes ? `${Math.round(e.sizeBytes / 1024)}KB` : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {new Date(e.capturedAt!).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {(isImage || isText) && (
                            <a href={`/api/evidence/${e.id}`} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] font-mono text-muted-foreground hover:text-foreground">view</a>
                          )}
                          <a href={`/api/evidence/${e.id}?dl`} download
                            className="text-[10px] font-mono text-muted-foreground hover:text-foreground">dl</a>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Runs */}
      {agentRuns.length > 0 && (
        <div id="agents">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono">
                Agent Runs <span className="text-muted-foreground">({agentRuns.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase">Agent</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Phase</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Started</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Ended</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.agent}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px] uppercase">{r.phase}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`font-mono text-[10px] ${
                          r.status === "running" ? "bg-pk-amber/20 text-pk-amber border-pk-amber/30 animate-pulse" :
                          r.status === "ok" ? "bg-pk-amber/20 text-pk-amber border-pk-amber/30" :
                          "bg-destructive/20 text-destructive border-destructive/30"
                        }`}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {new Date(r.startedAt!).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {r.endedAt ? new Date(r.endedAt).toLocaleTimeString() : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                        {r.summary ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Inbox */}
      <div id="inbox">
        <Inbox engagementId={id} />
      </div>
    </div>
  );
}
