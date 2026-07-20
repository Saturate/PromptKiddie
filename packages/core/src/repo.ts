/**
 * High-level logging / inbox API over the schema. The `pk` CLI and the future web frontend
 * both go through these functions so behavior stays consistent.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import {
  activityLog,
  agentLog,
  agentRuns,
  artifacts,
  discoveries,
  engagements,
  events,
  evidence,
  execDedup,
  findings,
  messages,
  objectives,
  ports,
  services,
  type ServiceApp,
  type ServiceCred,
  type ServiceCve,
  settings,
  targets,
} from "./schema.js";

/** Turn a name into a filesystem/url-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

type EngagementType = "ctf" | "whitebox" | "blackbox" | "bugbounty";

export async function createEngagement(input: {
  name: string;
  type: EngagementType;
  scope?: string;
  group?: string;
  sourceUrl?: string;
  brief?: string;
}) {
  const db = getDb();
  let slug = slugify(input.name);
  const existing = await db
    .select({ slug: engagements.slug })
    .from(engagements)
    .where(eq(engagements.slug, slug));
  if (existing.length > 0) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const [row] = await db
    .insert(engagements)
    .values({
      name: input.name,
      slug,
      type: input.type,
      scope: input.scope,
      group: input.group,
      sourceUrl: input.sourceUrl,
      brief: input.brief,
    })
    .returning();
  return row;
}

export async function listEngagements() {
  const db = getDb();
  return db.select().from(engagements).orderBy(desc(engagements.createdAt));
}

export async function getEngagement(id: string) {
  const db = getDb();
  const [row] = await db.select().from(engagements).where(eq(engagements.id, id));
  return row;
}

export async function updateEngagement(
  id: string,
  input: {
    name?: string;
    brief?: string;
    sourceUrl?: string;
    group?: string;
    scope?: string;
    type?: "ctf" | "whitebox" | "blackbox" | "bugbounty";
  },
) {
  const db = getDb();
  const [row] = await db.update(engagements).set(input).where(eq(engagements.id, id)).returning();
  return row;
}

export async function setEngagementStatus(
  id: string,
  status: "created" | "scoping" | "active" | "paused" | "reporting" | "done",
) {
  const db = getDb();
  const [row] = await db
    .update(engagements)
    .set({ status })
    .where(eq(engagements.id, id))
    .returning();
  await emitEvent(id, "StatusChanged", { status }, "system");
  return row;
}

type Phase = "scoping" | "recon" | "enum" | "exploit" | "postexploit" | "report";

const PHASE_ORDER: Phase[] = ["scoping", "recon", "enum", "exploit", "postexploit", "report"];

const ALLOWED_TRANSITIONS: Record<Phase, Phase[]> = {
  scoping:     ["recon"],
  recon:       ["scoping", "enum"],
  enum:        ["recon", "exploit"],
  exploit:     ["enum", "postexploit"],
  postexploit: ["exploit", "report"],
  report:      ["postexploit"],
};

export interface PhaseTransitionResult {
  engagement: Awaited<ReturnType<typeof getEngagement>>;
  warning?: string;
}

export async function advancePhase(
  id: string,
  targetPhase: Phase,
): Promise<PhaseTransitionResult> {
  const db = getDb();
  const eng = await getEngagement(id);
  if (!eng) throw new Error(`No engagement with id ${id}`);

  const currentPhase = (eng.phase ?? "scoping") as Phase;
  let warning: string | undefined;

  if (currentPhase === targetPhase) {
    return { engagement: eng };
  }

  const allowed = ALLOWED_TRANSITIONS[currentPhase];
  if (!allowed.includes(targetPhase)) {
    const currentIdx = PHASE_ORDER.indexOf(currentPhase);
    const targetIdx = PHASE_ORDER.indexOf(targetPhase);
    if (targetIdx > currentIdx) {
      const skipped = PHASE_ORDER.slice(currentIdx + 1, targetIdx);
      warning = `Skipping phases: ${skipped.join(", ")}. Jumping from ${currentPhase} to ${targetPhase}.`;
    } else {
      warning = `Going back from ${currentPhase} to ${targetPhase}.`;
    }
  }

  const [row] = await db
    .update(engagements)
    .set({ phase: targetPhase })
    .where(eq(engagements.id, id))
    .returning();

  return { engagement: row, warning };
}

export async function getPhase(id: string): Promise<{ phase: Phase; index: number; total: number }> {
  const eng = await getEngagement(id);
  if (!eng) throw new Error(`No engagement with id ${id}`);
  const p = (eng.phase ?? "scoping") as Phase;
  return { phase: p, index: PHASE_ORDER.indexOf(p), total: PHASE_ORDER.length };
}

// --- Webshells ---------------------------------------------------------------

export async function registerWebshell(engagementId: string, entry: { name: string; url: string; param?: string }) {
  const db = getDb();
  const eng = await getEngagement(engagementId);
  if (!eng) throw new Error(`No engagement with id ${engagementId}`);
  const current = (eng.webshells ?? []) as import("./schema.js").WebshellEntry[];
  let name = entry.name;
  if (!name) {
    try { name = new URL(entry.url).pathname.split("/").pop() || "shell"; }
    catch { name = entry.url.split("/").pop()?.split("?")[0] || "shell"; }
  }
  if (current.some((w) => w.name === name)) throw new Error(`Webshell "${name}" already registered`);
  const updated = [...current, { name, url: entry.url, param: entry.param ?? "cmd" }];
  const [row] = await db.update(engagements).set({ webshells: updated }).where(eq(engagements.id, engagementId)).returning();
  return { name, url: entry.url, param: entry.param ?? "cmd", engagement: row };
}

export async function listWebshells(engagementId: string) {
  const eng = await getEngagement(engagementId);
  if (!eng) throw new Error(`No engagement with id ${engagementId}`);
  return (eng.webshells ?? []) as import("./schema.js").WebshellEntry[];
}

export async function getWebshell(engagementId: string, nameOrUrl: string) {
  const shells = await listWebshells(engagementId);
  return shells.find((w) => w.name === nameOrUrl || w.url === nameOrUrl) ?? null;
}

// --- Targets ----------------------------------------------------------------

export async function addTarget(input: {
  engagementId: string;
  kind: "host" | "domain" | "url" | "app" | "repo";
  identifier: string;
  inScope?: boolean;
  notes?: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(targets)
    .values({
      engagementId: input.engagementId,
      kind: input.kind,
      identifier: input.identifier,
      inScope: input.inScope ?? false,
      notes: input.notes,
    })
    .returning();
  return row;
}

export async function listTargets(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(targets)
    .where(eq(targets.engagementId, engagementId))
    .orderBy(desc(targets.createdAt));
}

export async function updateTarget(
  id: string,
  input: { inScope?: boolean; notes?: string; kind?: "host" | "domain" | "url" | "app" | "repo"; identifier?: string },
) {
  const db = getDb();
  const [row] = await db.update(targets).set(input).where(eq(targets.id, id)).returning();
  return row;
}

// --- Ports -------------------------------------------------------------------

export async function addPort(input: {
  targetId: string;
  port: number;
  protocol?: "tcp" | "udp";
  state?: "open" | "closed" | "filtered";
  service?: string;
  version?: string;
  banner?: string;
  notes?: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(ports)
    .values({
      targetId: input.targetId,
      port: input.port,
      protocol: input.protocol ?? "tcp",
      state: input.state ?? "open",
      service: input.service,
      version: input.version,
      banner: input.banner,
      notes: input.notes,
    })
    .onConflictDoUpdate({
      target: [ports.targetId, ports.port, ports.protocol],
      set: {
        state: input.state ?? "open",
        service: input.service,
        version: input.version,
        banner: input.banner,
        notes: input.notes,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listPorts(targetId: string) {
  const db = getDb();
  return db
    .select()
    .from(ports)
    .where(eq(ports.targetId, targetId))
    .orderBy(ports.port);
}

export async function updatePort(
  id: string,
  input: {
    state?: "open" | "closed" | "filtered";
    service?: string;
    version?: string;
    banner?: string;
    notes?: string;
  },
) {
  const db = getDb();
  const [row] = await db
    .update(ports)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(ports.id, id))
    .returning();
  return row;
}

// --- Services (structured service entities) ---------------------------------

export async function addService(input: {
  engagementId: string;
  targetId: string;
  port?: number;
  protocol?: string;
  name?: string;
  product?: string;
  version?: string;
  cpe?: string;
  banner?: string;
  os?: string;
  tech?: string[];
  notes?: string;
  discoveredBy?: string;
  meta?: Record<string, unknown>;
}) {
  const db = getDb();
  const protocol = input.protocol ?? "tcp";

  const [row] = await db
    .insert(services)
    .values({
      engagementId: input.engagementId,
      targetId: input.targetId,
      port: input.port,
      protocol,
      name: input.name,
      product: input.product,
      version: input.version,
      cpe: input.cpe,
      banner: input.banner,
      os: input.os,
      tech: input.tech ?? [],
      notes: input.notes,
      discoveredBy: input.discoveredBy,
      meta: input.meta,
    })
    .onConflictDoUpdate({
      target: [services.engagementId, services.targetId, services.port, services.protocol, services.product],
      set: {
        ...(input.version != null ? { version: input.version } : {}),
        ...(input.cpe != null ? { cpe: input.cpe } : {}),
        ...(input.banner != null ? { banner: input.banner } : {}),
        ...(input.os != null ? { os: input.os } : {}),
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.tech?.length ? { tech: input.tech } : {}),
        ...(input.notes != null ? { notes: input.notes } : {}),
        ...(input.meta != null ? { meta: input.meta } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();

  const isNewRow = row.createdAt.getTime() === row.updatedAt.getTime();
  if (input.version && input.product && isNewRow) {
    await emitEvent(input.engagementId, "VersionIdentified", {
      product: input.product,
      version: input.version,
      port: input.port,
      service: input.name,
      serviceId: row.id,
    }, "agent");

    await addDiscovery({
      engagementId: input.engagementId,
      type: "positive",
      category: "version",
      summary: `${input.product} ${input.version}${input.port ? ` on port ${input.port}` : ""}`,
    });
  }

  return row;
}

export async function updateService(
  id: string,
  input: {
    version?: string;
    name?: string;
    product?: string;
    cpe?: string;
    banner?: string;
    os?: string;
    tech?: string[];
    notes?: string;
    meta?: Record<string, unknown>;
  },
) {
  const db = getDb();

  const existing = await db.select().from(services).where(eq(services.id, id)).limit(1);
  if (!existing.length) throw new Error(`Service ${id} not found`);

  const [row] = await db
    .update(services)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(services.id, id))
    .returning();

  const versionChanged = input.version && input.version !== existing[0].version;
  const product = input.product ?? row.product;
  if (versionChanged && product) {
    await emitEvent(row.engagementId, "VersionIdentified", {
      product,
      version: input.version,
      port: row.port,
      service: row.name,
      serviceId: row.id,
    }, "agent");

    await addDiscovery({
      engagementId: row.engagementId,
      type: "positive",
      category: "version",
      summary: `${product} ${input.version}${row.port ? ` on port ${row.port}` : ""}`,
    });
  }

  return row;
}

export async function addServiceApp(serviceId: string, app: ServiceApp) {
  const db = getDb();
  const existing = await db.select({ apps: services.apps }).from(services).where(eq(services.id, serviceId));
  if (!existing.length) throw new Error(`Service ${serviceId} not found`);
  const currentApps = (existing[0].apps ?? []) as ServiceApp[];
  if (currentApps.some((a) => a.name === app.name && a.path === app.path)) {
    const [row] = await db.select().from(services).where(eq(services.id, serviceId));
    return row;
  }
  const [row] = await db
    .update(services)
    .set({
      apps: sql`coalesce(${services.apps}, '[]'::jsonb) || ${JSON.stringify([app])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(services.id, serviceId))
    .returning();

  if (app.version && app.name) {
    await emitEvent(row.engagementId, "VersionIdentified", {
      product: app.name,
      version: app.version,
      port: row.port,
      service: row.name,
      serviceId: row.id,
    }, "agent");

    await addDiscovery({
      engagementId: row.engagementId,
      type: "positive",
      category: "version",
      summary: `${app.name} ${app.version}${app.path ? ` at ${app.path}` : ""}${row.port ? ` on port ${row.port}` : ""}`,
    });
  }

  return row;
}

export async function addServiceCred(serviceId: string, cred: ServiceCred) {
  const db = getDb();
  const existing = await db.select({ creds: services.creds }).from(services).where(eq(services.id, serviceId));
  if (!existing.length) throw new Error(`Service ${serviceId} not found`);
  const currentCreds = (existing[0].creds ?? []) as ServiceCred[];
  if (currentCreds.some((c) => c.username === cred.username && c.source === cred.source)) {
    const [row] = await db.select().from(services).where(eq(services.id, serviceId));
    return row;
  }
  const [row] = await db
    .update(services)
    .set({
      creds: sql`coalesce(${services.creds}, '[]'::jsonb) || ${JSON.stringify([cred])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(services.id, serviceId))
    .returning();

  await addArtifact({
    engagementId: row.engagementId,
    title: `${cred.username}${cred.password ? `:${cred.password}` : cred.hash ? ` (${cred.hashType ?? "hash"})` : ""}`,
    type: "credential",
    content: cred.password
      ? `${cred.username}:${cred.password}`
      : cred.hash
        ? `${cred.username}:${cred.hash}`
        : cred.username,
    meta: { serviceId: row.id, source: cred.source, verified: cred.verified },
  });

  return row;
}

export async function addServiceCve(serviceId: string, cve: ServiceCve) {
  const db = getDb();
  const existing = await db.select({ cves: services.cves }).from(services).where(eq(services.id, serviceId));
  if (!existing.length) throw new Error(`Service ${serviceId} not found`);
  const currentCves = (existing[0].cves ?? []) as ServiceCve[];
  if (currentCves.some((c) => c.id === cve.id)) {
    const [row] = await db.select().from(services).where(eq(services.id, serviceId));
    return row;
  }
  const [row] = await db
    .update(services)
    .set({
      cves: sql`coalesce(${services.cves}, '[]'::jsonb) || ${JSON.stringify([cve])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(services.id, serviceId))
    .returning();

  if (cve.status === "confirmed") {
    const validSeverities = ["critical", "high", "medium", "low", "info"] as const;
    type Severity = typeof validSeverities[number];
    const sev: Severity = validSeverities.includes(cve.severity as Severity)
      ? cve.severity as Severity
      : "info";

    await addFinding({
      engagementId: row.engagementId,
      targetId: row.targetId,
      serviceId: row.id,
      title: `${cve.id}${row.product ? ` in ${row.product}` : ""}${row.version ? ` ${row.version}` : ""}`,
      severity: sev,
      cvss: cve.cvss,
      cve: [cve.id],
      status: "confirmed",
      description: cve.notes,
    });
  }

  return row;
}

export async function listServices(
  engagementId: string,
  opts?: { targetId?: string },
) {
  const db = getDb();
  const conditions = [eq(services.engagementId, engagementId)];
  if (opts?.targetId) conditions.push(eq(services.targetId, opts.targetId));
  return db
    .select()
    .from(services)
    .where(and(...conditions))
    .orderBy(services.port);
}

export async function getService(id: string) {
  const db = getDb();
  const [svc] = await db.select().from(services).where(eq(services.id, id));
  if (!svc) return null;
  const linkedFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.serviceId, id));
  return { ...svc, findings: linkedFindings };
}

export async function listAllCreds(engagementId: string) {
  const db = getDb();
  const rows = await db
    .select({
      serviceId: services.id,
      port: services.port,
      product: services.product,
      version: services.version,
      creds: services.creds,
    })
    .from(services)
    .where(eq(services.engagementId, engagementId));

  return rows.flatMap((r) =>
    (r.creds ?? []).map((c: ServiceCred) => ({
      serviceId: r.serviceId,
      port: r.port,
      product: r.product,
      version: r.version,
      ...c,
    })),
  );
}

// --- Objectives (CTF tasks / flags) ----------------------------------------

export async function addObjective(input: {
  engagementId: string;
  taskNumber: number;
  title: string;
  description?: string;
  flagFormat?: string;
}) {
  const db = getDb();
  const [row] = await db.insert(objectives).values(input).returning();
  return row;
}

export async function listObjectives(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(objectives)
    .where(eq(objectives.engagementId, engagementId))
    .orderBy(objectives.taskNumber);
}

export async function captureFlag(id: string, flag: string) {
  const db = getDb();
  const [row] = await db
    .update(objectives)
    .set({ flag, completed: true })
    .where(eq(objectives.id, id))
    .returning();
  return row;
}

export async function updateObjective(
  id: string,
  input: { title?: string; description?: string; flagFormat?: string; flag?: string; completed?: boolean },
) {
  const db = getDb();
  const [row] = await db.update(objectives).set(input).where(eq(objectives.id, id)).returning();
  return row;
}

export async function addFinding(input: {
  engagementId: string;
  title: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  cvss?: number;
  cvssVector?: string;
  cwe?: string;
  status?: "triage" | "confirmed" | "reported" | "remediated";
  owasp?: string[];
  attackTechniques?: string[];
  cve?: string[];
  targetId?: string;
  serviceId?: string;
  description?: string;
  exploitScenario?: string;
  preconditions?: string[];
  sourceRef?: string;
  sinkRef?: string;
  confidence?: number;
  remediation?: string;
  verdict?: "true_positive" | "false_positive" | "unverified";
  verdictConfidence?: number;
  verdictReason?: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(findings)
    .values({
      engagementId: input.engagementId,
      title: input.title,
      severity: input.severity ?? "info",
      cvss: input.cvss,
      cvssVector: input.cvssVector,
      cwe: input.cwe,
      status: input.status ?? "triage",
      owasp: input.owasp,
      attackTechniques: input.attackTechniques,
      cve: input.cve,
      targetId: input.targetId,
      serviceId: input.serviceId,
      description: input.description,
      exploitScenario: input.exploitScenario,
      preconditions: input.preconditions,
      sourceRef: input.sourceRef,
      sinkRef: input.sinkRef,
      confidence: input.confidence,
      remediation: input.remediation,
      verdict: input.verdict,
      verdictConfidence: input.verdictConfidence,
      verdictReason: input.verdictReason,
    })
    .returning();
  return row;
}

export async function listFindings(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(findings)
    .where(eq(findings.engagementId, engagementId))
    .orderBy(desc(findings.createdAt));
}

export async function updateFinding(
  id: string,
  input: {
    title?: string;
    severity?: "critical" | "high" | "medium" | "low" | "info";
    cvss?: number;
    cvssVector?: string;
    cwe?: string;
    status?: "triage" | "confirmed" | "reported" | "remediated";
    owasp?: string[];
    attackTechniques?: string[];
    cve?: string[];
    targetId?: string;
    description?: string;
    exploitScenario?: string;
    preconditions?: string[];
    sourceRef?: string;
    sinkRef?: string;
    confidence?: number;
    remediation?: string;
    verdict?: "true_positive" | "false_positive" | "unverified";
    verdictConfidence?: number;
    verdictReason?: string;
  },
) {
  const db = getDb();
  const [row] = await db
    .update(findings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(findings.id, id))
    .returning();
  return row;
}

/** Register an on-disk artifact: hash it, capture size, and link it to the engagement. */
// --- Artifacts (loot, creds, documents, configs) ---------------------------

export async function addArtifact(input: {
  engagementId: string;
  title: string;
  type: string;
  content?: string;
  path?: string;
  findingId?: string;
  meta?: Record<string, unknown>;
}) {
  const db = getDb();
  const [row] = await db.insert(artifacts).values(input).returning();
  return row;
}

export async function listArtifacts(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.engagementId, engagementId))
    .orderBy(desc(artifacts.createdAt));
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json",
  ".jsonl": "text/plain", ".xml": "application/xml", ".html": "text/html",
  ".csv": "text/csv", ".log": "text/plain",
};

function guessMime(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export async function addEvidence(input: {
  engagementId: string;
  path: string;
  type: "flag" | "screenshot" | "scan" | "output" | "file";
  findingId?: string;
  sha256?: string;
  sizeBytes?: number;
  data?: Buffer;
  meta?: Record<string, unknown>;
}) {
  const db = getDb();
  let hash = input.sha256;
  let size = input.sizeBytes;
  let data = input.data;

  if (!data) {
    try {
      data = await readFile(input.path);
    } catch { /* file may not exist in remote/docker mode */ }
  }

  if (data) {
    hash = hash ?? createHash("sha256").update(data).digest("hex");
    size = size ?? data.length;
  } else if (!hash || size === undefined) {
    try {
      const buf = await readFile(input.path);
      hash = createHash("sha256").update(buf).digest("hex");
      size = (await stat(input.path)).size;
      data = buf;
    } catch { /* non-fatal: evidence recorded without data */ }
  }

  const [row] = await db
    .insert(evidence)
    .values({
      engagementId: input.engagementId,
      findingId: input.findingId,
      type: input.type,
      path: input.path,
      sha256: hash,
      sizeBytes: size,
      data: data,
      mimeType: guessMime(input.path),
      meta: input.meta,
    })
    .returning();
  return row;
}

export async function getEvidenceData(id: string) {
  const db = getDb();
  const [row] = await db
    .select({ data: evidence.data, mimeType: evidence.mimeType, path: evidence.path })
    .from(evidence)
    .where(eq(evidence.id, id));
  return row;
}

export async function listEvidence(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(evidence)
    .where(eq(evidence.engagementId, engagementId))
    .orderBy(desc(evidence.capturedAt));
}

export async function listActivity(engagementId: string, limit?: number) {
  const db = getDb();
  const q = db
    .select()
    .from(activityLog)
    .where(eq(activityLog.engagementId, engagementId))
    .orderBy(desc(activityLog.createdAt));
  return limit ? q.limit(limit) : q;
}

export async function deleteEngagement(id: string) {
  const db = getDb();
  const [row] = await db.delete(engagements).where(eq(engagements.id, id)).returning();
  return row;
}

// --- Agent reasoning log ---------------------------------------------------

export async function addAgentLog(input: {
  engagementId: string;
  agent: string;
  phase: "scoping" | "recon" | "enum" | "exploit" | "postexploit" | "report";
  message: string;
  category?: string;
}) {
  const db = getDb();
  const [row] = await db.insert(agentLog).values(input).returning();
  return row;
}

export async function listAgentLog(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(agentLog)
    .where(eq(agentLog.engagementId, engagementId))
    .orderBy(desc(agentLog.createdAt));
}

export async function logActivity(input: {
  engagementId: string;
  phase: "scoping" | "recon" | "enum" | "exploit" | "postexploit" | "report";
  action: string;
  command?: string;
  actor?: "orchestrator" | "agent" | "human";
  resultEvidenceId?: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(activityLog)
    .values({
      engagementId: input.engagementId,
      phase: input.phase,
      action: input.action,
      command: input.command,
      actor: input.actor ?? "orchestrator",
      resultEvidenceId: input.resultEvidenceId,
    })
    .returning();
  return row;
}

export async function listAgentRuns(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.engagementId, engagementId))
    .orderBy(desc(agentRuns.startedAt));
}

export async function startAgentRun(input: {
  engagementId: string;
  agent: string;
  phase: "scoping" | "recon" | "enum" | "exploit" | "postexploit" | "report";
}) {
  const db = getDb();
  const [row] = await db
    .insert(agentRuns)
    .values({ engagementId: input.engagementId, agent: input.agent, phase: input.phase })
    .returning();
  return row;
}

export async function finishAgentRun(input: {
  runId: string;
  status: "ok" | "failed";
  summary?: string;
}) {
  const db = getDb();
  const [row] = await db
    .update(agentRuns)
    .set({ status: input.status, summary: input.summary, endedAt: new Date() })
    .where(eq(agentRuns.id, input.runId))
    .returning();
  return row;
}

// --- Inbox -----------------------------------------------------------------

export async function subscribeMessages(
  callback: (payload: Record<string, unknown>) => void,
): Promise<() => void> {
  const pg = await import("pg");
  const { databaseUrl } = await import("./db.js");
  const client = new pg.default.Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query("LISTEN new_message");
  client.on("notification", (msg) => {
    if (msg.channel === "new_message" && msg.payload) {
      try {
        callback(JSON.parse(msg.payload));
      } catch {
        // ignore parse errors
      }
    }
  });
  return () => { client.end().catch(() => {}); };
}

export async function listMessages(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.engagementId, engagementId))
    .orderBy(messages.createdAt);
}

/** Fetch new inbound messages and mark them read. The orchestrator's poll loop. */
export async function pollInbox(engagementId?: string) {
  const db = getDb();
  const where = engagementId
    ? and(eq(messages.direction, "inbound"), eq(messages.status, "new"), eq(messages.engagementId, engagementId))
    : and(eq(messages.direction, "inbound"), eq(messages.status, "new"));

  const inbound = await db.select().from(messages).where(where).orderBy(messages.createdAt);

  if (inbound.length > 0) {
    const ids = inbound.map((m) => m.id);
    for (const id of ids) {
      await db.update(messages).set({ status: "read" }).where(eq(messages.id, id));
    }
  }
  return inbound;
}

/** Send a message into the inbox (default outbound from the orchestrator). */
export async function sendMessage(input: {
  body: string;
  engagementId?: string;
  direction?: "inbound" | "outbound";
  author?: string;
}) {
  const db = getDb();
  const direction = input.direction ?? "outbound";
  const [row] = await db
    .insert(messages)
    .values({
      engagementId: input.engagementId,
      direction,
      author: input.author ?? (direction === "outbound" ? "orchestrator" : "human"),
      body: input.body,
    })
    .returning();
  return row;
}

// --- Events ------------------------------------------------------------------

export async function emitEvent(
  engagementId: string,
  type: string,
  payload: Record<string, unknown>,
  source: string,
) {
  const db = getDb();
  const [row] = await db
    .insert(events)
    .values({ engagementId, type, payload, source })
    .returning();
  return row;
}

export async function listEvents(
  engagementId: string,
  opts?: { type?: string },
) {
  const db = getDb();
  const conditions = [eq(events.engagementId, engagementId)];
  if (opts?.type) conditions.push(eq(events.type, opts.type));
  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.createdAt));
}

// --- Discoveries -------------------------------------------------------------

type DiscoveryType = "positive" | "negative" | "attempted";

export async function addDiscovery(input: {
  engagementId: string;
  type: DiscoveryType;
  category: string;
  summary: string;
  detail?: Record<string, unknown>;
  sourceEventId?: string;
  parentId?: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(discoveries)
    .values({
      engagementId: input.engagementId,
      type: input.type,
      category: input.category,
      summary: input.summary,
      detail: input.detail,
      sourceEventId: input.sourceEventId,
      parentId: input.parentId,
    })
    .returning();
  return row;
}

export async function listDiscoveries(
  engagementId: string,
  opts?: { category?: string; type?: DiscoveryType },
) {
  const db = getDb();
  const conditions = [eq(discoveries.engagementId, engagementId)];
  if (opts?.category) conditions.push(eq(discoveries.category, opts.category));
  if (opts?.type) conditions.push(eq(discoveries.type, opts.type));
  return db
    .select()
    .from(discoveries)
    .where(and(...conditions))
    .orderBy(desc(discoveries.createdAt));
}

export { buildLlmContext as getDiscoverySummary } from "./context-builder.js";

// --- Exec dedup --------------------------------------------------------------

export async function recordExecOutcome(
  engagementId: string,
  command: string,
  target: string,
  exitCode: number,
  outcomeSummary?: string,
) {
  const db = getDb();
  const [row] = await db
    .insert(execDedup)
    .values({
      engagementId,
      commandNormalized: command,
      target,
      exitCode,
      outcomeSummary,
    })
    .onConflictDoUpdate({
      target: [execDedup.engagementId, execDedup.commandNormalized, execDedup.target, execDedup.exitCode],
      set: {
        count: sql`${execDedup.count} + 1`,
        lastAt: new Date(),
        outcomeSummary: outcomeSummary ?? sql`${execDedup.outcomeSummary}`,
      },
    })
    .returning();
  return row;
}

export async function getExecDedup(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(execDedup)
    .where(eq(execDedup.engagementId, engagementId))
    .orderBy(desc(execDedup.lastAt));
}

export async function isExecBlocked(
  engagementId: string,
  command: string,
  target: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ count: execDedup.count })
    .from(execDedup)
    .where(
      and(
        eq(execDedup.engagementId, engagementId),
        eq(execDedup.commandNormalized, command),
        eq(execDedup.target, target),
        sql`${execDedup.exitCode} != 0`,
      ),
    );
  return rows.some((r) => r.count >= 2);
}

// --- Settings ----------------------------------------------------------------

export async function getSetting(key: string) {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: unknown) {
  const db = getDb();
  const [row] = await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .returning();
  return row;
}

export async function getAllSettings() {
  const db = getDb();
  return db.select().from(settings);
}

export async function seedDefaultSettings() {
  const defaults: Record<string, unknown> = {
    "chat.mode": "harness",
    "chat.provider": "anthropic",
    "chat.orchestrator_model": "claude-opus-4-8",
    "chat.subagent_model": "claude-opus-4-8",
    "chat.max_steps": 0,
    "embeddings.provider": "onnx",
    "embeddings.model": "Xenova/all-MiniLM-L6-v2",
    "embeddings.url": "",
    "embeddings.dimensions": 384,
  };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = await getSetting(key);
    if (existing === null) {
      await setSetting(key, value);
    }
  }
}

