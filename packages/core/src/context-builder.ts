import {
  listTargets,
  listPorts,
  listServices,
  listDiscoveries,
  getExecDedup,
  listFindings,
  listArtifacts,
  listEvidence,
} from "./repo.js";
import type { ServiceApp, ServiceCve } from "./schema.js";

export interface LlmContextService {
  id: string;
  port: number | null;
  name: string | null;
  product: string | null;
  version: string | null;
  apps: Array<{ name: string; version?: string; path?: string }>;
  cred_count: number;
  cves: Array<{ id: string; status: string }>;
}

export interface LlmContext {
  target: string;
  ports: Array<{ port: number; service: string | null; version: string | null; banner: string | null }>;
  hostnames: string[];
  services: LlmContextService[];
  downloaded_files: Array<{ path: string; type: string | null }>;
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

  const portsByTarget = await Promise.all(tgts.map((t) => listPorts(t.id)));
  const allPorts: LlmContext["ports"] = portsByTarget.flat().map((port) => ({
    port: port.port,
    service: port.service,
    version: port.version,
    banner: port.banner,
  }));

  const [svcs, discs, execRows, fds, arts, evs] = await Promise.all([
    listServices(engagementId),
    listDiscoveries(engagementId),
    getExecDedup(engagementId),
    listFindings(engagementId),
    listArtifacts(engagementId),
    listEvidence(engagementId),
  ]);

  const servicesList: LlmContextService[] = svcs.map((s) => {
    const apps = s.apps ?? [];
    const creds = s.creds ?? [];
    const cves = s.cves ?? [];
    return {
      id: s.id,
      port: s.port,
      name: s.name,
      product: s.product,
      version: s.version,
      apps: apps.map((a: ServiceApp) => ({
        name: a.name, version: a.version, path: a.path,
      })),
      cred_count: creds.length,
      cves: cves.map((c: ServiceCve) => ({
        id: c.id, status: c.status,
      })),
    };
  });

  const hostnames = discs
    .filter((d) => d.category === "hostname" && d.type === "positive")
    .map((d) => d.summary);

  const downloaded_files = evs
    .filter((e) => e.type === "file" && e.path)
    .map((e) => ({
      path: e.path!,
      type: (e.meta as Record<string, unknown> | null)?.fileType as string | null ?? null,
    }));

  const discoveryList = discs.map((d) => ({
    type: d.type,
    category: d.category,
    summary: d.summary,
  }));

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

  const findingsList = fds.map((f) => ({
    id: f.id,
    title: f.title,
    severity: f.severity,
    status: f.status,
  }));

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
    services: servicesList,
    downloaded_files,
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
