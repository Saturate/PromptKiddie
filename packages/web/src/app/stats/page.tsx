import {
  listEngagements,
  listActivity,
  listFindings,
  listTargets,
} from "@promptkiddie/core";
import { AutoRefresh } from "@/components/auto-refresh";
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
import { ToolFrequencyChart, PhaseDistributionChart } from "@/components/stats-charts";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const engagements = await listEngagements();

  const engData = await Promise.all(
    engagements.map(async (e) => {
      const activity = await listActivity(e.id);
      const findingsList = await listFindings(e.id);
      const targetsList = await listTargets(e.id);
      return { engagement: e, activity, findings: findingsList, targets: targetsList };
    }),
  );

  const allActivity = engData.flatMap((d) => d.activity);
  const allFindings = engData.flatMap((d) => d.findings);

  const toolExecs = allActivity.filter((a) => a.command);
  const confirmedCount = allFindings.filter((f) => f.status === "confirmed").length;
  const triageCount = allFindings.filter((f) => f.status === "triage").length;

  const phaseCounts: Record<string, number> = {};
  for (const a of allActivity) {
    phaseCounts[a.phase] = (phaseCounts[a.phase] ?? 0) + 1;
  }
  const mostUsedPhase = Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])[0];

  const avgActions = engagements.length > 0
    ? Math.round(allActivity.length / engagements.length)
    : 0;

  // Tool frequency: extract first word from command
  const toolCounts: Record<string, number> = {};
  for (const a of toolExecs) {
    const cmd = a.command?.trim() ?? "";
    const tool = cmd.split(/\s+/)[0].replace(/^.*\//, ""); // strip path
    if (tool) toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
  }
  const toolData = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, value]) => ({ name, value }));

  // Phase distribution
  const phases = ["scoping", "recon", "enum", "exploit", "postexploit", "report"];
  const phaseData = phases.map((p) => ({ name: p, value: phaseCounts[p] ?? 0 }));

  // Engagement table with stats
  const engTableData = engData.map((d) => {
    const phaseActivity = d.activity.filter((a) => a.phase === d.engagement.phase);
    const firstInPhase = phaseActivity.length > 0
      ? phaseActivity[phaseActivity.length - 1].createdAt
      : null;
    const timeInPhase = firstInPhase
      ? Math.round((Date.now() - new Date(firstInPhase!).getTime()) / 60000)
      : null;

    return {
      id: d.engagement.id,
      name: d.engagement.name,
      actions: d.activity.length,
      findings: d.findings.length,
      targets: d.targets.length,
      phase: d.engagement.phase ?? "scoping",
      timeInPhase,
    };
  });

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <AutoRefresh interval={30000} />
      <h1 className="text-xl font-bold font-mono">Stats</h1>

      {/* Row 1 - Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Tool Executions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold font-mono">{toolExecs.length}</p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {Object.keys(toolCounts).length} unique tools
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Avg Actions / Engagement
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold font-mono">{avgActions}</p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {allActivity.length} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Most Active Phase
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold font-mono">{mostUsedPhase?.[0] ?? "-"}</p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {mostUsedPhase?.[1] ?? 0} actions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Findings
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold font-mono">{allFindings.length}</p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {confirmedCount} confirmed, {triageCount} triage
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Row 2 - Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono">Tool Frequency</CardTitle>
            <p className="text-[11px] text-muted-foreground font-mono">
              Most used tools across all engagements
            </p>
          </CardHeader>
          <CardContent>
            <ToolFrequencyChart data={toolData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono">Activity by Phase</CardTitle>
            <p className="text-[11px] text-muted-foreground font-mono">
              Actions logged per methodology phase
            </p>
          </CardHeader>
          <CardContent>
            <PhaseDistributionChart data={phaseData} />
          </CardContent>
        </Card>
      </div>

      {/* Row 3 - Engagement table with stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono">Engagement Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Actions</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Findings</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Targets</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Phase</TableHead>
                <TableHead className="font-mono text-[10px] uppercase">Time in Phase</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {engTableData.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link
                      href={`/engagements/${e.id}`}
                      className="text-primary hover:underline font-mono text-sm"
                    >
                      {e.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{e.actions}</TableCell>
                  <TableCell className="font-mono text-sm">{e.findings}</TableCell>
                  <TableCell className="font-mono text-sm">{e.targets}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {e.phase}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {e.timeInPhase !== null ? `${e.timeInPhase}m` : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
