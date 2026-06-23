/**
 * High-level logging / inbox API over the schema. The `pk` CLI and the future web frontend
 * both go through these functions so behavior stays consistent.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import {
  activityLog,
  agentRuns,
  engagements,
  evidence,
  findings,
  messages,
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
}) {
  const db = getDb();
  let slug = slugify(input.name);
  // Ensure slug uniqueness with a short suffix if needed.
  const existing = await db
    .select({ slug: engagements.slug })
    .from(engagements)
    .where(eq(engagements.slug, slug));
  if (existing.length > 0) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const [row] = await db
    .insert(engagements)
    .values({ name: input.name, slug, type: input.type, scope: input.scope })
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

export async function setEngagementStatus(
  id: string,
  status: "scoping" | "active" | "paused" | "reporting" | "done",
) {
  const db = getDb();
  const [row] = await db
    .update(engagements)
    .set({ status })
    .where(eq(engagements.id, id))
    .returning();
  return row;
}

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

export async function addFinding(input: {
  engagementId: string;
  title: string;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  cvss?: number;
  status?: "triage" | "confirmed" | "reported" | "remediated";
  owasp?: string[];
  attackTechniques?: string[];
  cve?: string[];
  targetId?: string;
  description?: string;
  remediation?: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(findings)
    .values({
      engagementId: input.engagementId,
      title: input.title,
      severity: input.severity ?? "info",
      cvss: input.cvss,
      status: input.status ?? "triage",
      owasp: input.owasp,
      attackTechniques: input.attackTechniques,
      cve: input.cve,
      targetId: input.targetId,
      description: input.description,
      remediation: input.remediation,
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
    status?: "triage" | "confirmed" | "reported" | "remediated";
    owasp?: string[];
    attackTechniques?: string[];
    cve?: string[];
    targetId?: string;
    description?: string;
    remediation?: string;
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
export async function addEvidence(input: {
  engagementId: string;
  path: string;
  type: "screenshot" | "scan" | "output" | "file";
  findingId?: string;
  meta?: Record<string, unknown>;
}) {
  const db = getDb();
  const buf = await readFile(input.path);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const { size } = await stat(input.path);

  const [row] = await db
    .insert(evidence)
    .values({
      engagementId: input.engagementId,
      findingId: input.findingId,
      type: input.type,
      path: input.path,
      sha256,
      sizeBytes: size,
      meta: input.meta,
    })
    .returning();
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

export async function listActivity(engagementId: string) {
  const db = getDb();
  return db
    .select()
    .from(activityLog)
    .where(eq(activityLog.engagementId, engagementId))
    .orderBy(desc(activityLog.createdAt));
}

export async function deleteEngagement(id: string) {
  const db = getDb();
  const [row] = await db.delete(engagements).where(eq(engagements.id, id)).returning();
  return row;
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
