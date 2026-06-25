import { listEngagements, listFindings } from "@promptkiddie/core";
import Link from "next/link";
import { createEngagementAction } from "./actions";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CardContent } from "@/components/ui/card";
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
import { ShieldAlertIcon, TargetIcon, AlertTriangleIcon, InfoIcon } from "lucide-react";

export const dynamic = "force-dynamic";

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
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      {/* Section cards - dashboard-01 style */}
      <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Engagements</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {engagements.length}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <TargetIcon />
                {activeCount} active
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">
              Total across all engagement types
            </div>
          </CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Critical Findings</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {severityCounts.critical}
            </CardTitle>
            <CardAction>
              <Badge variant="destructive">
                <ShieldAlertIcon />
                CVSS 9.0+
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">
              {severityCounts.high} high, {severityCounts.medium} medium
            </div>
          </CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Total Findings</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {allFindings.length}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <AlertTriangleIcon />
                all severities
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">
              {allFindings.filter((f) => f.status === "confirmed").length} confirmed, {allFindings.filter((f) => f.status === "triage").length} in triage
            </div>
          </CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Low / Info</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {severityCounts.low + severityCounts.info}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">
                <InfoIcon />
                notes
              </Badge>
            </CardAction>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground">
              {severityCounts.low} low, {severityCounts.info} informational
            </div>
          </CardFooter>
        </Card>
      </div>

      {/* Create engagement */}
      <div className="px-4 lg:px-6">
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
      </div>

      {/* Engagements table */}
      <div className="px-4 lg:px-6">
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
                          className="text-primary hover:underline font-mono text-sm"
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
    </div>
  );
}
