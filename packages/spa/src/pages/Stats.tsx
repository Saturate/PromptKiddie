import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEngagements, fetchFindings, fetchActivity, fetchTargets } from "@/api/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToolFrequencyChart, PhaseDistributionChart } from "@/components/stats-charts";
import { PageState, SectionLabel, StatTile } from "@/components/pk";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function Stats() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const engagements = await fetchEngagements() as Any[];
      const engData = await Promise.all(
        engagements.map(async (e: Any) => {
          const [activity, findings, targets] = await Promise.all([
            fetchActivity(e.id), fetchFindings(e.id), fetchTargets(e.id),
          ]);
          return { engagement: e, activity: activity as Any[], findings: findings as Any[], targets: targets as Any[] };
        }),
      );
      const allActivity = engData.flatMap((d) => d.activity);
      const allFindings = engData.flatMap((d) => d.findings);
      return { engagements, allActivity, allFindings, engData };
    },
  });

  if (isLoading || isError || !data) {
    return <PageState isLoading={isLoading} isError={isError} refetch={refetch} label="statistics"><></></PageState>;
  }

  const { engagements, allActivity, allFindings, engData } = data;
  const toolExecs = allActivity.filter((a: Any) => a.command);
  const confirmedCount = allFindings.filter((f: Any) => f.status === "confirmed").length;

  const toolCounts: Record<string, number> = {};
  for (const a of toolExecs) {
    const tool = (a as Any).command?.split(" ")[0] ?? "unknown";
    toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
  }
  const toolData = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, value]) => ({ name, value }));

  const phaseCounts: Record<string, number> = {};
  for (const a of allActivity) phaseCounts[(a as Any).phase] = (phaseCounts[(a as Any).phase] ?? 0) + 1;
  const phaseData = Object.entries(phaseCounts).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold font-mono">Statistics</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Engagements" value={engagements.length} />
        <StatTile label="Total Actions" value={allActivity.length} />
        <StatTile label="Tool Executions" value={toolExecs.length} />
        <StatTile label="Findings" value={allFindings.length} sub={`${confirmedCount} confirmed`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Top Tools</h3>
          <ToolFrequencyChart data={toolData} />
        </div>
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-3">Activity by Phase</h3>
          <PhaseDistributionChart data={phaseData} />
        </div>
      </div>

      <section>
        <SectionLabel>Per Engagement</SectionLabel>
        <div className="border border-border rounded-lg overflow-hidden mt-2">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
              <TableHead className="font-mono text-[10px] uppercase text-right">Actions</TableHead>
              <TableHead className="font-mono text-[10px] uppercase text-right">Findings</TableHead>
              <TableHead className="font-mono text-[10px] uppercase text-right">Targets</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {engData.map(({ engagement: e, activity: a, findings: f, targets: t }: Any) => (
                <TableRow key={e.id} className="hover:bg-accent/50 transition-colors">
                  <TableCell><Link to={`/engagements/${e.id}`} className="text-pk-amber hover:underline font-mono text-sm font-semibold">{e.name}</Link></TableCell>
                  <TableCell className="font-mono text-sm tabular-nums text-right">{a.length}</TableCell>
                  <TableCell className="font-mono text-sm tabular-nums text-right">{f.length}</TableCell>
                  <TableCell className="font-mono text-sm tabular-nums text-right">{t.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
