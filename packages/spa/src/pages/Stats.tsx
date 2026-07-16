import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchEngagements, fetchFindings, fetchActivity, fetchTargets } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ToolFrequencyChart, PhaseDistributionChart } from "@/components/stats-charts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export default function Stats() {
  const [data, setData] = useState<{
    engagements: Any[]; allActivity: Any[]; allFindings: Any[];
    engData: { engagement: Any; activity: Any[]; findings: Any[]; targets: Any[] }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
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
      setData({ engagements, allActivity, allFindings, engData });
    })();
  }, []);

  if (!data) return <div className="p-6 text-muted-foreground font-mono">Loading...</div>;

  const { engagements, allActivity, allFindings, engData } = data;
  const toolExecs = allActivity.filter((a) => a.command);
  const confirmedCount = allFindings.filter((f) => f.status === "confirmed").length;

  const phaseCounts: Record<string, number> = {};
  for (const a of allActivity) phaseCounts[a.phase] = (phaseCounts[a.phase] ?? 0) + 1;
  const mostUsedPhase = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])[0];

  const toolCounts: Record<string, number> = {};
  for (const a of toolExecs) {
    const tool = a.command?.split(" ")[0] ?? "unknown";
    toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
  }
  const toolData = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, value]) => ({ name, value }));
  const phaseData = Object.entries(phaseCounts).map(([name, value]) => ({ name, value }));

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <h1 className="text-xl font-bold font-mono">Statistics</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Engagements</p><p className="text-2xl font-bold font-mono">{engagements.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Total Actions</p><p className="text-2xl font-bold font-mono">{allActivity.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Tool Executions</p><p className="text-2xl font-bold font-mono">{toolExecs.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Findings</p><p className="text-2xl font-bold font-mono">{allFindings.length}</p><p className="text-[10px] text-muted-foreground font-mono">{confirmedCount} confirmed</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-mono">Top Tools</CardTitle></CardHeader>
          <CardContent><ToolFrequencyChart data={toolData} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-mono">Activity by Phase</CardTitle></CardHeader>
          <CardContent><PhaseDistributionChart data={phaseData} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-mono">Per Engagement</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
              <TableHead className="font-mono text-[10px] uppercase">Actions</TableHead>
              <TableHead className="font-mono text-[10px] uppercase">Findings</TableHead>
              <TableHead className="font-mono text-[10px] uppercase">Targets</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {engData.map(({ engagement: e, activity: a, findings: f, targets: t }) => (
                <TableRow key={e.id}>
                  <TableCell><Link to={`/engagements/${e.id}`} className="text-primary hover:underline font-mono text-sm">{e.name}</Link></TableCell>
                  <TableCell className="font-mono text-sm">{a.length}</TableCell>
                  <TableCell className="font-mono text-sm">{f.length}</TableCell>
                  <TableCell className="font-mono text-sm">{t.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
