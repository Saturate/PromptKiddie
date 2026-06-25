import { listEngagements, listFindings } from "@promptkiddie/core";
import Link from "next/link";
import { createEngagementAction } from "./actions";
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
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const severityColors: Record<string, string> = {
  critical: "bg-severity-critical text-white",
  high: "bg-severity-high text-black",
  medium: "bg-severity-medium text-black",
  low: "bg-severity-low text-white",
  info: "bg-severity-info text-white",
};

export default async function Home() {
  const engagements = await listEngagements();

  const allFindings = (
    await Promise.all(engagements.map((e) => listFindings(e.id)))
  ).flat();

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of allFindings) {
    if (f.severity in severityCounts) {
      severityCounts[f.severity as keyof typeof severityCounts]++;
    }
  }

  const activeCount = engagements.filter((e) => e.status === "active").length;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold font-mono">Dashboard</h1>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              Engagements
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold font-mono">{engagements.length}</p>
            <p className="text-[11px] text-muted-foreground font-mono">
              {activeCount} active
            </p>
          </CardContent>
        </Card>

        {(Object.entries(severityCounts) as [string, number][]).map(
          ([sev, count]) => (
            <Card key={sev}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  {sev}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-2xl font-bold font-mono">{count}</p>
                <Badge
                  className={`text-[9px] font-mono ${severityColors[sev] ?? ""}`}
                >
                  {sev}
                </Badge>
              </CardContent>
            </Card>
          ),
        )}
      </div>

      {/* Create engagement */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono">New Engagement</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createEngagementAction} className="flex gap-2 items-center">
            <Input
              name="name"
              placeholder="Name..."
              required
              autoComplete="off"
              className="flex-1 font-mono text-sm"
            />
            <select
              name="type"
              required
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-mono"
            >
              <option value="ctf">CTF</option>
              <option value="whitebox">Whitebox</option>
              <option value="blackbox">Blackbox</option>
              <option value="bugbounty">Bug Bounty</option>
            </select>
            <Button type="submit" className="font-mono text-sm">
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Engagements table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono">
            All Engagements
          </CardTitle>
        </CardHeader>
        <CardContent>
          {engagements.length === 0 ? (
            <p className="text-sm text-muted-foreground font-mono">
              No engagements yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[10px] uppercase">Name</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Type</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Phase</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {engagements.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/engagements/${e.id}`}
                        className="text-pk-green hover:underline font-mono text-sm"
                      >
                        {e.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {e.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {e.phase ?? "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {new Date(e.createdAt!).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
