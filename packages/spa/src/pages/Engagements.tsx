import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEngagements, fetchFindings, fetchTargets } from "@/api/client";
import { CreateEngagementDialog } from "@/components/create-engagement-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ExternalLinkIcon, RefreshCw } from "lucide-react";

const statusDot: Record<string, string> = {
  active: "bg-emerald-400",
  done: "bg-blue-400",
  scoping: "bg-zinc-400",
  paused: "bg-yellow-400",
  reporting: "bg-purple-400",
  created: "bg-zinc-500",
};

const phaseText: Record<string, string> = {
  scoping: "text-zinc-400",
  recon: "text-blue-400",
  enum: "text-purple-400",
  exploit: "text-red-400",
  postexploit: "text-orange-400",
  report: "text-emerald-400",
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xl font-bold font-mono">Engagements</h1>
          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            {engagements.length} total
            <span className="mx-1.5 text-border">|</span>
            <span className="text-emerald-400">{activeCount}</span> active
            <span className="mx-1.5 text-border">|</span>
            <span className="text-blue-400">{doneCount}</span> done
            {Object.entries(typeCounts).map(([type, count]) => (
              <span key={type}><span className="mx-1.5 text-border">|</span>{count} {type}</span>
            ))}
          </span>
        </div>
        <CreateEngagementDialog />
      </div>

      {sortedGroups.map(([groupName, items]) => (
        <section key={groupName}>
          {sortedGroups.length > 1 && (
            <h2 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2 pl-1">{groupName}</h2>
          )}
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
                  <TableHead className="font-mono text-[10px] uppercase w-10">Src</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(({ engagement: e, findingsCount, targetsCount }) => (
                  <TableRow key={e.id} className="hover:bg-accent/50 transition-colors">
                    <TableCell>
                      <Link to={`/engagements/${e.id}`} className="text-pk-amber hover:underline font-mono text-sm font-semibold">{e.name}</Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.type}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[e.status] ?? "bg-zinc-500"}`} />
                        {e.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`font-mono text-xs ${phaseText[e.phase ?? "scoping"] ?? "text-muted-foreground"}`}>
                        {e.phase ?? "scoping"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-right">{findingsCount}</TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-right">{targetsCount}</TableCell>
                    <TableCell>
                      {e.sourceUrl ? (
                        <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                          <ExternalLinkIcon className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground/30">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs tabular-nums text-right">{new Date(e.createdAt!).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}

      {engagements.length === 0 && (
        <div className="border border-border rounded-lg p-12 text-center">
          <p className="text-sm text-muted-foreground font-mono">No engagements yet.</p>
          <p className="text-xs text-muted-foreground/50 font-mono mt-1">Create one to get started.</p>
        </div>
      )}
    </div>
  );
}
