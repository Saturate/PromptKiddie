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
  agentLog,
  agentRuns,
  artifacts,
  engagements,
  evidence,
  findings,
  messages,
  objectives,
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
  input: { name?: string; brief?: string; sourceUrl?: string; group?: string; scope?: string },
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

export async function addEvidence(input: {
  engagementId: string;
  path: string;
  type: "flag" | "screenshot" | "scan" | "output" | "file";
  findingId?: string;
  sha256?: string;
  sizeBytes?: number;
  meta?: Record<string, unknown>;
}) {
  const db = getDb();
  let hash = input.sha256;
  let size = input.sizeBytes;
  if (!hash || size === undefined) {
    const buf = await readFile(input.path);
    hash = createHash("sha256").update(buf).digest("hex");
    size = (await stat(input.path)).size;
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
  };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = await getSetting(key);
    if (existing === null) {
      await setSetting(key, value);
    }
  }
}
