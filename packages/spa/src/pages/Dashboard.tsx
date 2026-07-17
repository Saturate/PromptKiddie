import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchEngagements, fetchFindings, fetchActivity, fetchTargets } from "@/api/client";
import {
  Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShieldAlertIcon, TargetIcon, AlertTriangleIcon, TerminalIcon } from "lucide-react";
import { SeverityPieChart, PhaseBarChart } from "@/components/dashboard-charts";
import { CreateEngagementDialog } from "@/components/create-engagement-dialog";

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  done: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  scoping: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  paused: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30",
  reporting: "bg-purple-500/15 text-purple-500 border-purple-500/30",
};

const phaseColors: Record<string, string> = {
  scoping: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  recon: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  enum: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  exploit: "bg-red-500/15 text-red-400 border-red-500/30",
  postexploit: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  report: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

interface Engagement { id: string; name: string; type: string; status: string; phase?: string; createdAt?: string }
interface Finding { id: string; severity: string; status: string }
interface Activity { id: string; phase: string; action: string; command?: string; actor?: string; createdAt?: string }
interface Target { id: string }

export default function Dashboard() {
  const [data, setData] = useState<{
    engagements: Engagement[];
    perEngagement: { engagement: Engagement; findings: Finding[]; activity: Activity[]; targets: Target[] }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      const engagements = await fetchEngagements() as Engagement[];
      const perEngagement = await Promise.all(
        engagements.map(async (e) => {
          const [findings, activity, targets] = await Promise.all([
            fetchFindings(e.id) as Promise<Finding[]>,
            fetchActivity(e.id) as Promise<Activity[]>,
            fetchTargets(e.id) as Promise<Target[]>,
          ]);
          return { engagement: e, findings, activity, targets };
        }),
      );
      setData({ engagements, perEngagement });
    })();
  }, []);

  if (!data) return <div className="p-6 text-muted-foreground font-mono">Loading...</div>;

  const { engagements, perEngagement } = data;
  const allFindings = perEngagement.flatMap((p) => p.findings);
  const allActivity = perEngagement.flatMap((p) =>
    p.activity.map((a) => ({ ...a, engagementName: p.engagement.name, engagementId: p.engagement.id })),
  );

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of allFindings) {
    if (f.severity in severityCounts) severityCounts[f.severity as keyof typeof severityCounts]++;
  }

  const phaseCounts = { scoping: 0, recon: 0, enum: 0, exploit: 0, postexploit: 0, report: 0 };
  for (const a of allActivity) {
    if (a.phase in phaseCounts) phaseCounts[a.phase as keyof typeof phaseCounts]++;
  }

  const activeCount = engagements.filter((e) => e.status === "active").length;
  const doneCount = engagements.filter((e) => e.status === "done").length;
  const confirmedCount = allFindings.filter((f) => f.status === "confirmed").length;
  const toolsRun = allActivity.filter((a) => a.command).length;

  const severityData = Object.entries(severityCounts).map(([name, value]) => ({ name, value }));
  const phaseData = Object.entries(phaseCounts).map(([name, value]) => ({ name, value }));

  const recentActivity = allActivity
    .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Engagements</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{engagements.length}</CardTitle>
            <CardAction><Badge variant="outline"><TargetIcon className="h-3 w-3" />{activeCount} active</Badge></CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground font-mono text-xs">{activeCount} active, {doneCount} done, {engagements.length - activeCount - doneCount} other</div>
          </CardFooter>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Total Findings</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{allFindings.length}</CardTitle>
            <CardAction><Badge variant="outline"><AlertTriangleIcon className="h-3 w-3" />all severities</Badge></CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground font-mono text-xs">{confirmedCount} confirmed, {allFindings.length - confirmedCount} in triage</div>
          </CardFooter>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Critical + High</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums text-destructive @[250px]/card:text-3xl">{severityCounts.critical + severityCounts.high}</CardTitle>
            <CardAction><Badge variant="destructive"><ShieldAlertIcon className="h-3 w-3" />urgent</Badge></CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground font-mono text-xs">{severityCounts.critical} critical, {severityCounts.high} high</div>
          </CardFooter>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Tools Run</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{toolsRun}</CardTitle>
            <CardAction><Badge variant="outline"><TerminalIcon className="h-3 w-3" />commands</Badge></CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground font-mono text-xs">{allActivity.length} total actions across {engagements.length} engagements</div>
          </CardFooter>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono">Findings by Severity</CardTitle>
            <CardDescription className="font-mono text-xs">Distribution across all engagements</CardDescription>
          </CardHeader>
          <CardContent>
            <SeverityPieChart data={severityData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono">Activity by Phase</CardTitle>
            <CardDescription className="font-mono text-xs">Actions logged per methodology phase</CardDescription>
          </CardHeader>
          <CardContent>
            <PhaseBarChart data={phaseData} />
          </CardContent>
        </Card>
      </div>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono">All Engagements</CardTitle>
              <CreateEngagementDialog />
            </div>
          </CardHeader>
          <CardContent>
            {engagements.length === 0 ? (
              <div className="text-center py-8 space-y-1">
                <p className="text-sm text-muted-foreground font-mono">No engagements yet.</p>
                <p className="text-xs text-primary/40 italic font-mono">what are you, a script kiddie?</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Phase</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Findings</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Targets</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perEngagement.map(({ engagement: e, findings: f, targets: t }) => (
                    <TableRow key={e.id}>
                      <TableCell><Link to={`/engagements/${e.id}`} className="text-primary hover:underline font-mono text-sm">{e.name}</Link></TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-[10px]">{e.type}</Badge></TableCell>
                      <TableCell><Badge className={`font-mono text-[10px] border ${statusColors[e.status] ?? ""}`}>{e.status}</Badge></TableCell>
                      <TableCell><Badge className={`font-mono text-[10px] border ${phaseColors[e.phase ?? "scoping"] ?? ""}`}>{e.phase ?? "scoping"}</Badge></TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">{f.length}</TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">{t.length}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{new Date(e.createdAt!).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono">Recent Activity</CardTitle>
            <CardDescription className="font-mono text-xs">Last {recentActivity.length} actions across all engagements</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <div className="text-center py-8 space-y-1">
                <p className="text-sm text-muted-foreground font-mono">No activity yet.</p>
                <p className="text-xs text-primary/40 italic font-mono">the logs are empty and that&apos;s suspicious</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActivity.map((a) => (
                  <div key={a.id} className="border border-border rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`font-mono text-[10px] border ${phaseColors[a.phase] ?? ""}`}>{a.phase}</Badge>
                      <Link to={`/engagements/${a.engagementId}`} className="text-primary hover:underline font-mono text-xs">{a.engagementName}</Link>
                      <span className="text-muted-foreground font-mono text-[10px] ml-auto">{a.actor} &middot; {new Date(a.createdAt!).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-sm font-mono text-foreground">{a.action}</p>
                    {a.command && (
                      <div className="bg-background border border-border rounded px-3 py-1.5 flex items-center gap-1.5">
                        <span className="text-primary/50 font-mono text-xs">$</span>
                        <code className="text-foreground font-mono text-xs">{a.command}</code>
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
