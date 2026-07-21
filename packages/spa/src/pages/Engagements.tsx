import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchEngagements, fetchFindings, fetchTargets, setEngagementStatus } from "@/api/client";
import { CreateEngagementDialog } from "@/components/create-engagement-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLinkIcon, Play, Pause, RotateCcw } from "lucide-react";
import { StatusDot, PhaseText, PageState, SectionLabel } from "@/components/pk";

interface Engagement { id: string; name: string; type: string; status: string; phase?: string; group?: string; sourceUrl?: string; createdAt?: string }

function QuickAction({ id, status }: { id: string; status: string }) {
  const queryClient = useQueryClient();
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = status === "active" ? "paused" : "active";
    await setEngagementStatus(id, next);
    queryClient.invalidateQueries({ queryKey: ["engagements-page"] });
  };
  const reopen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await setEngagementStatus(id, "active");
    queryClient.invalidateQueries({ queryKey: ["engagements-page"] });
  };

  if (status === "done" || status === "reporting") {
    return (
      <button onClick={reopen} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors" title="Reopen">
        <RotateCcw className="size-3" />
      </button>
    );
  }
  if (status === "active") {
    return (
      <button onClick={toggle} className="text-muted-foreground hover:text-yellow-400 p-1 rounded transition-colors" title="Pause">
        <Pause className="size-3" />
      </button>
    );
  }
  return (
    <button onClick={toggle} className="text-muted-foreground hover:text-emerald-400 p-1 rounded transition-colors" title="Start">
      <Play className="size-3" />
    </button>
  );
}

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

  if (isLoading || isError || !data) {
    return <PageState isLoading={isLoading} isError={isError} refetch={refetch} label="engagements"><></></PageState>;
  }

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
            <SectionLabel>{groupName}</SectionLabel>
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
                  <TableHead className="font-mono text-[10px] uppercase w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(({ engagement: e, findingsCount, targetsCount }) => (
                  <TableRow key={e.id} className="hover:bg-accent/50 transition-colors">
                    <TableCell>
                      <Link to={`/engagements/${e.id}`} className="text-pk-amber hover:underline font-mono text-sm font-semibold">{e.name}</Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{e.type}</TableCell>
                    <TableCell><StatusDot status={e.status} /></TableCell>
                    <TableCell><PhaseText phase={e.phase ?? "scoping"} /></TableCell>
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
                    <TableCell>
                      <QuickAction id={e.id} status={e.status} />
                    </TableCell>
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
