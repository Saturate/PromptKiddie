import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEngagements, fetchFindings, fetchTargets } from "@/api/client";
import { CreateEngagementDialog } from "@/components/create-engagement-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLinkIcon, RefreshCw } from "lucide-react";

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

const typeColors: Record<string, string> = {
  ctf: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  whitebox: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  blackbox: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  bugbounty: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

interface Engagement { id: string; name: string; type: string; status: string; phase?: string; group?: string; sourceUrl?: string; createdAt?: string }

export default function Engagements() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["engagements-page"],
    queryFn: async () => {
      const engagements = await fetchEngagements() as Engagement[];
      const perEngagement = await Promise.all(
        engagements.map(async (e) => {
          const [findings, targets] = await Promise.all([
            fetchFindings(e.id) as Promise<unknown[]>,
            fetchTargets(e.id) as Promise<unknown[]>,
          ]);
          return { engagement: e, findingsCount: findings.length, targetsCount: targets.length };
        }),
      );
      return perEngagement;
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground font-mono">Loading...</div>;
  if (isError) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-destructive font-mono">Failed to load engagements.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
          <RefreshCw className="size-3 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }
  if (!data) return null;

  const engagements = data.map((d) => d.engagement);
  const activeCount = engagements.filter((e) => e.status === "active").length;
  const doneCount = engagements.filter((e) => e.status === "done").length;
  const scopingCount = engagements.filter((e) => e.status === "scoping").length;

  const typeCounts: Record<string, number> = {};
  for (const e of engagements) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;

  const grouped: Record<string, typeof data> = {};
  for (const item of data) {
    const key = item.engagement.group || "Ungrouped";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    if (a === "Ungrouped") return 1;
    if (b === "Ungrouped") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold font-mono">Engagements</h1>
        <CreateEngagementDialog />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Total</p><p className="text-2xl font-bold font-mono">{engagements.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Active</p><p className="text-2xl font-bold font-mono text-primary">{activeCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Done</p><p className="text-2xl font-bold font-mono text-blue-500">{doneCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">Scoping</p><p className="text-2xl font-bold font-mono text-zinc-400">{scopingCount}</p></CardContent></Card>
        {Object.entries(typeCounts).map(([type, count]) => (
          <Card key={type}><CardContent className="p-4"><p className="text-[10px] font-mono uppercase text-muted-foreground">{type}</p><p className="text-2xl font-bold font-mono">{count}</p></CardContent></Card>
        ))}
      </div>

      {sortedGroups.map(([groupName, items]) => (
        <Card key={groupName}>
          <CardContent className="p-0">
            {sortedGroups.length > 1 && (
              <div className="px-4 pt-4 pb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{groupName}</span>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Phase</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Findings</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Targets</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Source</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(({ engagement: e, findingsCount, targetsCount }) => (
                  <TableRow key={e.id}>
                    <TableCell><Link to={`/engagements/${e.id}`} className="text-primary hover:underline font-mono text-sm">{e.name}</Link></TableCell>
                    <TableCell><Badge variant="outline" className={`font-mono text-[10px] ${typeColors[e.type] ?? ""}`}>{e.type}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={`font-mono text-[10px] ${statusColors[e.status] ?? ""}`}>{e.status}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={`font-mono text-[10px] ${phaseColors[e.phase ?? "scoping"] ?? ""}`}>{e.phase ?? "scoping"}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{findingsCount}</TableCell>
                    <TableCell className="font-mono text-sm">{targetsCount}</TableCell>
                    <TableCell>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLinkIcon className="h-3.5 w-3.5" /></a> : <span className="text-muted-foreground text-xs">-</span>}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{new Date(e.createdAt!).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {engagements.length === 0 && (
        <Card><CardContent className="p-8 text-center"><p className="text-sm text-muted-foreground font-mono">No engagements yet. Create one to get started.</p></CardContent></Card>
      )}
    </div>
  );
}
