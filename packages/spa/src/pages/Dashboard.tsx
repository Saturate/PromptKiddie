import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEngagements, fetchFindings, fetchActivity, fetchTargets } from "@/api/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeverityPieChart, PhaseBarChart } from "@/components/dashboard-charts";
import { CreateEngagementDialog } from "@/components/create-engagement-dialog";
import { StatusDot, PhaseText, PageState } from "@/components/pk";

interface Engagement { id: string; name: string; type: string; status: string; phase?: string; createdAt?: string }
interface Finding { id: string; severity: string; status: string }
interface Activity { id: string; phase: string; action: string; command?: string; actor?: string; createdAt?: string; engagementName?: string; engagementId?: string }
interface Target { id: string }

export default function Dashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
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
      return { engagements, perEngagement };
    },
  });

  if (isLoading || isError || !data) {
    return <PageState isLoading={isLoading} isError={isError} refetch={refetch} label="dashboard"><></></PageState>;
  }

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
    .slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Stat tiles - compact grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Engagements</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{engagements.length}</div>
          <div className="text-[10px] font-mono text-pk-amber">{activeCount} active</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Findings</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{allFindings.length}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{confirmedCount} confirmed</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Critical + High</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-destructive">{severityCounts.critical + severityCounts.high}</div>
          <div className="text-[10px] font-mono text-destructive/70">{severityCounts.critical} crit, {severityCounts.high} high</div>
        </div>
        <div className="bg-card border border-border rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Tools Run</div>
          <div className="text-2xl font-bold font-mono tabular-nums">{toolsRun}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{allActivity.length} actions</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Findings by Severity</h3>
          <SeverityPieChart data={severityData} />
        </div>
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Activity by Phase</h3>
          <PhaseBarChart data={phaseData} />
        </div>
      </div>

      {/* Engagements table */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Engagements</h3>
          <CreateEngagementDialog />
        </div>
        {engagements.length === 0 ? (
          <div className="text-center py-8 border border-border rounded-lg">
            <p className="text-sm text-muted-foreground font-mono">No engagements yet.</p>
            <p className="text-xs text-primary/40 font-mono mt-1">what are you, a script kiddie?</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Phase</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Findings</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Targets</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perEngagement.map(({ engagement: e, findings: f, targets: t }) => (
                  <TableRow key={e.id} className="hover:bg-accent/50 transition-colors">
                    <TableCell>
                      <Link to={`/engagements/${e.id}`} className="text-pk-amber hover:underline font-mono text-sm font-semibold">
                        {e.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.type}</TableCell>
                    <TableCell><StatusDot status={e.status} /></TableCell>
                    <TableCell><PhaseText phase={e.phase ?? "scoping"} /></TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-right">{f.length}</TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-right">{t.length}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs text-right">{new Date(e.createdAt!).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Recent activity - compact list */}
      <section>
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Recent Activity</h3>
        {recentActivity.length === 0 ? (
          <div className="text-center py-8 border border-border rounded-lg">
            <p className="text-sm text-muted-foreground font-mono">No activity yet.</p>
            <p className="text-xs text-primary/40 font-mono mt-1">the logs are empty and that&apos;s suspicious</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg divide-y divide-border">
            {recentActivity.map((a) => (
              <div key={a.id} className="px-3 py-2 hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 w-16"><PhaseText phase={a.phase} /></span>
                  <Link to={`/engagements/${a.engagementId}`} className="font-mono text-xs text-pk-amber hover:underline shrink-0">
                    {a.engagementName}
                  </Link>
                  <span className="font-mono text-xs text-foreground truncate min-w-0" title={a.action}>
                    {a.action}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground/60 ml-auto shrink-0 tabular-nums">
                    {new Date(a.createdAt!).toLocaleTimeString()}
                  </span>
                </div>
                {a.command && (
                  <div className="ml-16 mt-1 flex items-center gap-1.5">
                    <span className="text-pk-amber/40 font-mono text-[10px]">$</span>
                    <code className="font-mono text-[10px] text-muted-foreground truncate">{a.command}</code>
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
