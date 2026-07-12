import {
  listTargets,
  listPorts,
  listDiscoveries,
  getExecDedup,
  listFindings,
  listArtifacts,
} from "./repo.js";

export interface LlmContext {
  target: string;
  ports: Array<{ port: number; service: string | null; version: string | null; banner: string | null }>;
  hostnames: string[];
  versions: Array<{ product: string; version: string | null; cve_hits: number }>;
  discoveries: Array<{ type: string; category: string; summary: string }>;
  already_ran: Array<{ cmd: string; exit: number; result: string | null }>;
  failed_attempts: Array<{ cmd: string; exit: number; error: string | null; count: number }>;
  findings: Array<{ id: string; title: string; severity: string; status: string }>;
  artifacts: Array<{ id: string; title: string; type: string }>;
  estimated_tokens: number;
}

function estimateTokens(obj: unknown): number {
  const json = JSON.stringify(obj);
  return Math.ceil(json.length / 4);
}

export async function buildLlmContext(engagementId: string): Promise<LlmContext> {
  const tgts = await listTargets(engagementId);

  const allPorts: LlmContext["ports"] = [];
  for (const t of tgts) {
    const p = await listPorts(t.id);
    for (const port of p) {
      allPorts.push({
        port: port.port,
        service: port.service,
        version: port.version,
        banner: port.banner,
      });
    }
  }

  const discs = await listDiscoveries(engagementId);

  const hostnames = discs
    .filter((d) => d.category === "hostname" && d.type === "positive")
    .map((d) => d.summary);

  const versions = discs
    .filter((d) => d.category === "version" && d.type === "positive")
    .map((d) => ({
      product: d.summary,
      version: (d.detail as Record<string, unknown> | null)?.version as string | null ?? null,
      cve_hits: (d.detail as Record<string, unknown> | null)?.cve_hits as number ?? 0,
    }));

  const discoveryList = discs.map((d) => ({
    type: d.type,
    category: d.category,
    summary: d.summary,
  }));

  const execRows = await getExecDedup(engagementId);

  const already_ran = execRows
    .filter((r) => r.exitCode === 0)
    .map((r) => ({
      cmd: r.commandNormalized,
      exit: r.exitCode,
      result: r.outcomeSummary,
    }));

  const failed_attempts = execRows
    .filter((r) => r.exitCode !== 0)
    .map((r) => ({
      cmd: r.commandNormalized,
      exit: r.exitCode,
      error: r.outcomeSummary,
      count: r.count,
    }));

  const fds = await listFindings(engagementId);
  const findingsList = fds.map((f) => ({
    id: f.id,
    title: f.title,
    severity: f.severity,
    status: f.status,
  }));

  const arts = await listArtifacts(engagementId);
  const artifactsList = arts.map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
  }));

  const targetStr = tgts.map((t) => t.identifier).join(", ");

  const ctx: LlmContext = {
    target: targetStr,
    ports: allPorts,
    hostnames,
    versions,
    discoveries: discoveryList,
    already_ran,
    failed_attempts,
    findings: findingsList,
    artifacts: artifactsList,
    estimated_tokens: 0,
  };

  ctx.estimated_tokens = estimateTokens(ctx);
  return ctx;
}
