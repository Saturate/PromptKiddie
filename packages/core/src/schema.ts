/**
 * PromptKiddie database schema (Drizzle ORM, PostgreSQL).
 *
 * One Postgres database is the source of truth for engagements. Disk artifacts live under
 * `engagements/<slug>/` and are referenced from the `evidence` table by path + sha256.
 */
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() { return "bytea"; },
});

// --- Enums -----------------------------------------------------------------

export const engagementType = pgEnum("engagement_type", [
  "ctf",
  "whitebox",
  "blackbox",
  "bugbounty",
]);

export const engagementStatus = pgEnum("engagement_status", [
  "created",
  "scoping",
  "active",
  "paused",
  "reporting",
  "done",
]);

export const targetKind = pgEnum("target_kind", [
  "host",
  "domain",
  "url",
  "app",
  "repo",
]);

export const severity = pgEnum("severity", [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const findingStatus = pgEnum("finding_status", [
  "triage",
  "confirmed",
  "reported",
  "remediated",
]);

export const phase = pgEnum("phase", [
  "scoping",
  "recon",
  "enum",
  "exploit",
  "postexploit",
  "report",
]);

export const actor = pgEnum("actor", ["orchestrator", "agent", "human"]);

export const evidenceType = pgEnum("evidence_type", [
  "flag",
  "screenshot",
  "scan",
  "output",
  "file",
]);

export const agentRunStatus = pgEnum("agent_run_status", [
  "running",
  "ok",
  "failed",
]);

export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageStatus = pgEnum("message_status", ["new", "read", "done"]);

// --- Tables ----------------------------------------------------------------

/** One per CTF / assessment / bug-bounty program. Holds type, status, scope, RoE. */
export const engagements = pgTable("engagements", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: engagementType("type").notNull(),
  status: engagementStatus("status").notNull().default("created"),
  /** Current methodology phase (state machine). */
  phase: phase("phase").notNull().default("scoping"),
  /** Grouping label (e.g. "HTB", "THM", "Internal"). */
  group: text("group"),
  /** Link to source room/box (e.g. "https://tryhackme.com/room/neighbour"). */
  sourceUrl: text("source_url"),
  /** Room brief / task description for CTFs. */
  brief: text("brief"),
  /** Free-form scope summary; structured targets live in `targets`. */
  scope: text("scope"),
  /** Rules of Engagement: authorization, allowed/disallowed actions, windows. */
  roe: jsonb("roe").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** CTF tasks / room objectives. Each has a description and an expected flag to capture. */
export const objectives = pgTable(
  "objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    taskNumber: integer("task_number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** Hint about the flag format, e.g. "THM{...}" or "a single word". */
    flagFormat: text("flag_format"),
    /** The captured flag/answer once solved. */
    flag: text("flag"),
    completed: boolean("completed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("objectives_engagement_idx").on(t.engagementId)],
);

export const targetStatus = pgEnum("target_status", [
  "active",
  "expired",
]);

/** Hosts/domains/URLs/apps/repos within an engagement, with in-scope flag. */
export const targets = pgTable(
  "targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    kind: targetKind("kind").notNull(),
    identifier: text("identifier").notNull(),
    inScope: boolean("in_scope").notNull().default(false),
    /** Whether this target is still reachable. Expired = IP changed or machine stopped. */
    status: targetStatus("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("targets_engagement_idx").on(t.engagementId)],
);

export const portProtocol = pgEnum("port_protocol", ["tcp", "udp"]);
export const portState = pgEnum("port_state", ["open", "closed", "filtered"]);

/** Open ports discovered on targets. First-class entity for CTF and pentest engagements. */
export const ports = pgTable(
  "ports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetId: uuid("target_id")
      .notNull()
      .references(() => targets.id, { onDelete: "cascade" }),
    port: integer("port").notNull(),
    protocol: portProtocol("protocol").notNull().default("tcp"),
    state: portState("state").notNull().default("open"),
    service: text("service"),
    version: text("version"),
    banner: text("banner"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ports_target_idx").on(t.targetId),
    index("ports_unique").on(t.targetId, t.port, t.protocol),
  ],
);

export const findingVerdict = pgEnum("finding_verdict", [
  "true_positive",
  "false_positive",
  "unverified",
]);

/** Vulnerabilities / flags with severity, CVSS, and framework mappings. */
export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    targetId: uuid("target_id").references(() => targets.id, {
      onDelete: "set null",
    }),
    portId: uuid("port_id").references(() => ports.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    severity: severity("severity").notNull().default("info"),
    cvss: doublePrecision("cvss"),
    cvssVector: text("cvss_vector"),
    cwe: text("cwe"),
    status: findingStatus("status").notNull().default("triage"),
    /** OWASP refs, e.g. "A03:2021" or "WSTG-INPV-05". */
    owasp: text("owasp").array(),
    /** MITRE ATT&CK technique ids, e.g. "T1190". */
    attackTechniques: text("attack_techniques").array(),
    /** CVE ids, e.g. "CVE-2024-1234". */
    cve: text("cve").array(),
    description: text("description"),
    exploitScenario: text("exploit_scenario"),
    preconditions: text("preconditions").array(),
    sourceRef: text("source_ref"),
    sinkRef: text("sink_ref"),
    confidence: doublePrecision("confidence"),
    remediation: text("remediation"),
    verdict: findingVerdict("verdict").default("unverified"),
    verdictConfidence: integer("verdict_confidence"),
    verdictReason: text("verdict_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("findings_engagement_idx").on(t.engagementId)],
);

/** Files/screenshots/scan output, hashed (sha256) and linked to engagement/finding. */
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => findings.id, {
      onDelete: "set null",
    }),
    type: evidenceType("type").notNull(),
    /** Original path (kept for display/backwards compat). */
    path: text("path").notNull(),
    sha256: text("sha256"),
    sizeBytes: integer("size_bytes"),
    /** File contents stored in DB. */
    data: bytea("data"),
    mimeType: text("mime_type"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_engagement_idx").on(t.engagementId)],
);

/** Things found during an engagement: loot, credentials, documents, configs, interesting files. */
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => findings.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    type: text("type").notNull(),
    content: text("content"),
    /** Path on disk if saved to a file. */
    path: text("path"),
    sha256: text("sha256"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artifacts_engagement_idx").on(t.engagementId)],
);

/** Append-only audit trail: every notable command/action the orchestrator takes. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    actor: actor("actor").notNull().default("orchestrator"),
    phase: phase("phase").notNull(),
    action: text("action").notNull(),
    command: text("command"),
    /** Optional pointer to an evidence row capturing the result. */
    resultEvidenceId: uuid("result_evidence_id").references(() => evidence.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_engagement_idx").on(t.engagementId)],
);

/** One row per sub-agent invocation: agent, phase, status, summary. */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    phase: phase("phase").notNull(),
    status: agentRunStatus("status").notNull().default("running"),
    summary: text("summary"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("agent_runs_engagement_idx").on(t.engagementId)],
);

/** Agent reasoning log - self-reported thinking, hypotheses, decisions. */
export const agentLog = pgTable(
  "agent_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    agent: text("agent").notNull(),
    phase: phase("phase").notNull(),
    message: text("message").notNull(),
    /** Optional category: hypothesis, decision, observation, stuck, progress. */
    category: text("category"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_log_engagement_idx").on(t.engagementId)],
);

/** Key-value store for model/provider configuration and other settings. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Bidirectional human<->orchestrator inbox driving background operation. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id").references(() => engagements.id, {
      onDelete: "cascade",
    }),
    direction: messageDirection("direction").notNull(),
    /** Who wrote it: "human", "orchestrator", or a named source/agent. */
    author: text("author").notNull(),
    body: text("body").notNull(),
    status: messageStatus("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_engagement_idx").on(t.engagementId)],
);

export const embeddingSourceType = pgEnum("embedding_source_type", [
  "finding",
  "exec_output",
  "activity",
  "brief",
]);

/** Vector embeddings for semantic search across engagements (requires pgvector). */
export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    engagementId: uuid("engagement_id").references(() => engagements.id, {
      onDelete: "cascade",
    }),
    sourceType: embeddingSourceType("source_type").notNull(),
    sourceId: uuid("source_id"),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("embeddings_engagement_idx").on(t.engagementId),
    index("embeddings_source_type_idx").on(t.sourceType),
  ],
);
