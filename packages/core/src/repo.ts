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
  engagementSteps,
  evidence,
  findings,
  messages,
  objectives,
  playbookBlocks,
  playbooks,
  ports,
  settings,
  targets,
  type PlaybookPhase,
  type PlaybookStep,
} from "./schema.js";
import { DEFAULT_PLAYBOOKS } from "./playbooks.js";
import { BUILTIN_BLOCKS } from "./blocks.js";
import {
  findAutoSkips,
  findReadyNodes,
  getProgress,
  type GraphState,
} from "./bt-runtime.js";

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

// --- Playbooks ---------------------------------------------------------------

export async function seedPlaybooks() {
  const db = getDb();
  for (const [type, def] of Object.entries(DEFAULT_PLAYBOOKS)) {
    const existing = await db.select().from(playbooks)
      .where(and(eq(playbooks.engagementType, type as "ctf"), eq(playbooks.isDefault, true)));
    if (existing.length === 0) {
      await db.insert(playbooks).values({
        name: def.name,
        engagementType: type as "ctf",
        description: def.description,
        isDefault: true,
        phases: def.phases,
      });
    }
  }

  // Seed built-in blocks
  for (const block of BUILTIN_BLOCKS) {
    const existing = await db.select().from(playbookBlocks)
      .where(and(eq(playbookBlocks.name, block.name), eq(playbookBlocks.isBuiltin, true)));
    if (existing.length === 0) {
      await db.insert(playbookBlocks).values({
        name: block.name,
        description: block.description,
        inputSchema: block.inputSchema,
        outputSchema: block.outputSchema,
        nodes: block.nodes,
        isBuiltin: true,
      });
    }
  }
}

export async function getPlaybook(id: string) {
  const db = getDb();
  const [row] = await db.select().from(playbooks).where(eq(playbooks.id, id));
  return row ?? null;
}

export async function getDefaultPlaybook(engagementType: string) {
  const db = getDb();
  const [row] = await db.select().from(playbooks)
    .where(and(eq(playbooks.engagementType, engagementType as "ctf"), eq(playbooks.isDefault, true)));
  return row ?? null;
}

export async function listPlaybooks() {
  const db = getDb();
  return db.select().from(playbooks).orderBy(playbooks.name);
}

export async function createPlaybook(input: {
  name: string;
  engagementType: string;
  description?: string;
  phases: PlaybookPhase[];
}) {
  const db = getDb();
  const [row] = await db.insert(playbooks).values({
    name: input.name,
    engagementType: input.engagementType as "ctf",
    description: input.description ?? null,
    isDefault: false,
    phases: input.phases,
  }).returning();
  return row;
}

export async function updatePlaybook(id: string, input: {
  name?: string;
  description?: string;
  phases?: PlaybookPhase[];
}) {
  const db = getDb();
  const [row] = await db.update(playbooks)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(playbooks.id, id))
    .returning();
  return row;
}

export async function initEngagementSteps(engagementId: string, playbookId: string) {
  const db = getDb();
  const pb = await getPlaybook(playbookId);
  if (!pb) return [];

  const allBlocks = await db.select().from(playbookBlocks);
  const blockMap = new Map(allBlocks.map((b) => [b.name, b]));

  const phases = pb.phases as PlaybookPhase[];
  const rows = [];
  for (const phase of phases) {
    for (const step of phase.steps) {
      if (step.blockRef && blockMap.has(step.blockRef)) {
        const block = blockMap.get(step.blockRef)!;
        const blockNodes = block.nodes as PlaybookStep[];
        const suffix = `_${step.key.replace(/\./g, "_")}`;
        const keyMap = new Map(blockNodes.map((n) => [n.key, `${n.key}${suffix}`]));
        for (const node of blockNodes) {
          const mappedKey = keyMap.get(node.key)!;
          const mappedDeps = (node.dependsOn ?? []).map((d) => keyMap.get(d) ?? d);
          if (!node.dependsOn?.length && step.dependsOn?.length) {
            mappedDeps.push(...step.dependsOn);
          }
          const [row] = await db.insert(engagementSteps).values({
            engagementId,
            phase: phase.phase,
            stepKey: mappedKey,
            title: node.title,
            nodeType: node.nodeType ?? "action",
            dependsOn: mappedDeps,
            priority: node.priority ?? 50,
            condition: node.condition ?? step.condition ?? null,
            blockId: block.id,
          }).onConflictDoNothing().returning();
          if (row) rows.push(row);
        }
      } else {
        const [row] = await db.insert(engagementSteps).values({
          engagementId,
          phase: phase.phase,
          stepKey: step.key,
          title: step.title,
          nodeType: step.nodeType ?? "action",
          dependsOn: step.dependsOn ?? [],
          priority: step.priority ?? 50,
          condition: step.condition ?? null,
        }).onConflictDoNothing().returning();
        if (row) rows.push(row);
      }
    }
  }

  await db.update(engagements).set({ playbookId }).where(eq(engagements.id, engagementId));
  return rows;
}

export async function listEngagementSteps(engagementId: string) {
  const db = getDb();
  return db.select().from(engagementSteps)
    .where(eq(engagementSteps.engagementId, engagementId))
    .orderBy(engagementSteps.createdAt);
}

export async function completeStep(
  engagementId: string,
  stepKey: string,
  result?: { type: string; id: string },
) {
  const db = getDb();
  const [row] = await db.update(engagementSteps)
    .set({
      status: "done",
      completedAt: new Date(),
      resultType: result?.type,
      resultId: result?.id,
    })
    .where(and(
      eq(engagementSteps.engagementId, engagementId),
      eq(engagementSteps.stepKey, stepKey),
    ))
    .returning();
  return row;
}

export async function skipStep(
  engagementId: string,
  stepKey: string,
  reason: string,
) {
  const db = getDb();
  const [row] = await db.update(engagementSteps)
    .set({
      status: "skipped",
      skipReason: reason,
      completedAt: new Date(),
    })
    .where(and(
      eq(engagementSteps.engagementId, engagementId),
      eq(engagementSteps.stepKey, stepKey),
    ))
    .returning();
  return row;
}

export async function startStep(
  engagementId: string,
  stepKey: string,
  agentId?: string,
) {
  const db = getDb();
  const [row] = await db.update(engagementSteps)
    .set({
      status: "running",
      startedAt: new Date(),
      agentId: agentId ?? null,
    })
    .where(and(
      eq(engagementSteps.engagementId, engagementId),
      eq(engagementSteps.stepKey, stepKey),
    ))
    .returning();
  return row;
}

export async function getNextSteps(engagementId: string, maxSteps = 5) {
  const steps = await listEngagementSteps(engagementId);
  const tgts = await listTargets(engagementId);
  const allPorts = [];
  for (const t of tgts) {
    const p = await listPorts(t.id);
    allPorts.push(...p);
  }
  const fds = await listFindings(engagementId);
  const arts = await listArtifacts(engagementId);

  const state: GraphState = {
    steps: steps.map((s) => ({
      id: s.id,
      stepKey: s.stepKey,
      title: s.title,
      status: s.status as "pending" | "running" | "done" | "skipped",
      nodeType: s.nodeType ?? "action",
      dependsOn: s.dependsOn ?? [],
      priority: s.priority ?? 50,
      condition: s.condition,
      agentId: s.agentId,
      phase: s.phase,
    })),
    ports: allPorts.map((p) => ({ port: p.port, service: p.service, state: p.state })),
    findings: fds.map((f) => ({ id: f.id, severity: f.severity, title: f.title })),
    artifacts: arts.map((a) => ({ id: a.id, type: a.type })),
    targets: tgts.map((t) => ({ id: t.id, kind: t.kind, identifier: t.identifier, notes: t.notes })),
  };

  const autoSkips = findAutoSkips(state);
  for (const skip of autoSkips) {
    await skipStep(engagementId, skip.stepKey, `Condition not met: ${skip.condition}`);
  }

  if (autoSkips.length > 0) {
    const refreshed = await listEngagementSteps(engagementId);
    state.steps = refreshed.map((s) => ({
      id: s.id, stepKey: s.stepKey, title: s.title,
      status: s.status as "pending" | "running" | "done" | "skipped",
      nodeType: s.nodeType ?? "action", dependsOn: s.dependsOn ?? [],
      priority: s.priority ?? 50, condition: s.condition,
      agentId: s.agentId, phase: s.phase,
    }));
  }

  const ready = findReadyNodes(state).slice(0, maxSteps);
  const progress = getProgress(state);
  return { ready, progress, autoSkipped: autoSkips.length };
}
