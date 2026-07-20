#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getRepo } from "@promptkiddie/core";

const repo = getRepo();

const server = new McpServer({
  name: "promptkiddie",
  version: "0.1.0",
});

const json = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
});

// --- Engagements -----------------------------------------------------------

server.tool(
  "create_engagement",
  "Create a new engagement (CTF, whitebox, blackbox, or bugbounty).",
  {
    name: z.string(),
    type: z.enum(["ctf", "whitebox", "blackbox", "bugbounty"]),
    scope: z.string().optional(),
  },
  async ({ name, type, scope }) => {
    const eng = await repo.createEngagement({ name, type, scope });
    return json(eng);
  },
);

server.tool(
  "list_engagements",
  "List all engagements",
  async () => json(await repo.listEngagements()),
);

server.tool(
  "get_engagement",
  "Get engagement details including targets, findings, objectives, evidence, recent activity, artifacts, and agent runs",
  { id: z.string().uuid() },
  async ({ id }) => {
    const eng = await repo.getEngagement(id);
    if (!eng) return json({ error: `No engagement with id ${id}` });
    const activity = await repo.listActivity(id);
    return json({
      engagement: eng,
      targets: await repo.listTargets(id),
      findings: await repo.listFindings(id),
      objectives: await repo.listObjectives(id),
      evidence: await repo.listEvidence(id),
      activity: activity.slice(0, 50),
      artifacts: await repo.listArtifacts(id),
      agentRuns: await repo.listAgentRuns(id),
    });
  },
);

server.tool(
  "advance_phase",
  "Move the engagement to a methodology phase. Warns if skipping phases but allows it.",
  {
    id: z.string().uuid(),
    phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
  },
  async ({ id, phase }) => json(await repo.advancePhase(id, phase)),
);

server.tool(
  "get_phase",
  "Get the current methodology phase for an engagement",
  { id: z.string().uuid() },
  async ({ id }) => json(await repo.getPhase(id)),
);

server.tool(
  "set_engagement_status",
  "Update engagement status",
  {
    id: z.string().uuid(),
    status: z.enum(["scoping", "active", "paused", "reporting", "done"]),
  },
  async ({ id, status }) => json(await repo.setEngagementStatus(id, status)),
);

server.tool(
  "delete_engagement",
  "Delete an engagement and all its data (cascades)",
  { id: z.string().uuid() },
  async ({ id }) => {
    const row = await repo.deleteEngagement(id);
    if (!row) return json({ error: `No engagement with id ${id}` });
    return json(row);
  },
);

// --- Objectives ------------------------------------------------------------

server.tool(
  "add_objective",
  "Add an objective (task/challenge) to an engagement",
  {
    engagementId: z.string().uuid(),
    taskNumber: z.number(),
    title: z.string(),
    description: z.string().optional(),
    flagFormat: z.string().optional(),
  },
  async (input) => json(await repo.addObjective(input)),
);

server.tool(
  "list_objectives",
  "List objectives for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listObjectives(engagementId)),
);

server.tool(
  "capture_flag",
  "Mark an objective as captured with the flag value",
  {
    id: z.string().uuid(),
    flag: z.string(),
  },
  async ({ id, flag }) => json(await repo.captureFlag(id, flag)),
);

server.tool(
  "update_objective",
  "Update an objective (title, description, flagFormat, flag, completed)",
  {
    id: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().optional(),
    flagFormat: z.string().optional(),
    flag: z.string().optional(),
    completed: z.boolean().optional(),
  },
  async ({ id, ...rest }) => json(await repo.updateObjective(id, rest)),
);

// --- Artifacts -------------------------------------------------------------

server.tool(
  "add_artifact",
  "Add an artifact (loot, creds, docs) to an engagement",
  {
    engagementId: z.string().uuid(),
    title: z.string(),
    type: z.string(),
    content: z.string().optional(),
    path: z.string().optional(),
    findingId: z.string().uuid().optional(),
  },
  async (input) => json(await repo.addArtifact(input)),
);

server.tool(
  "list_artifacts",
  "List artifacts for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listArtifacts(engagementId)),
);

// --- Engagement updates ----------------------------------------------------

server.tool(
  "update_engagement",
  "Update engagement metadata (name, brief, sourceUrl, group, scope)",
  {
    id: z.string().uuid(),
    name: z.string().optional(),
    brief: z.string().optional(),
    sourceUrl: z.string().optional(),
    group: z.string().optional(),
    scope: z.string().optional(),
  },
  async ({ id, ...rest }) => json(await repo.updateEngagement(id, rest)),
);

// --- Agent runs (list) -----------------------------------------------------

server.tool(
  "list_agent_runs",
  "List agent runs for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listAgentRuns(engagementId)),
);

// --- Targets ---------------------------------------------------------------

server.tool(
  "add_target",
  "Add a target to an engagement",
  {
    engagementId: z.string().uuid(),
    kind: z.enum(["host", "domain", "url", "app", "repo"]),
    identifier: z.string(),
    inScope: z.boolean().optional(),
    notes: z.string().optional(),
  },
  async (input) => json(await repo.addTarget(input)),
);

server.tool(
  "list_targets",
  "List targets for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listTargets(engagementId)),
);

server.tool(
  "update_target",
  "Update a target (scope, notes, kind, identifier)",
  {
    id: z.string().uuid(),
    inScope: z.boolean().optional(),
    notes: z.string().optional(),
    kind: z.enum(["host", "domain", "url", "app", "repo"]).optional(),
    identifier: z.string().optional(),
  },
  async ({ id, ...rest }) => json(await repo.updateTarget(id, rest)),
);

// --- Findings --------------------------------------------------------------

server.tool(
  "add_finding",
  "Add a finding (vulnerability/flag) to an engagement",
  {
    engagementId: z.string().uuid(),
    title: z.string(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
    cvss: z.number().optional(),
    status: z.enum(["triage", "confirmed", "reported", "remediated"]).optional(),
    owasp: z.array(z.string()).optional(),
    attackTechniques: z.array(z.string()).optional(),
    cve: z.array(z.string()).optional(),
    targetId: z.string().uuid().optional(),
    description: z.string().optional(),
    remediation: z.string().optional(),
  },
  async (input) => json(await repo.addFinding(input)),
);

server.tool(
  "list_findings",
  "List findings for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listFindings(engagementId)),
);

server.tool(
  "update_finding",
  "Update a finding (status, severity, CVSS, framework tags, etc.)",
  {
    id: z.string().uuid(),
    title: z.string().optional(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
    cvss: z.number().optional(),
    status: z.enum(["triage", "confirmed", "reported", "remediated"]).optional(),
    owasp: z.array(z.string()).optional(),
    attackTechniques: z.array(z.string()).optional(),
    cve: z.array(z.string()).optional(),
    targetId: z.string().uuid().optional(),
    description: z.string().optional(),
    remediation: z.string().optional(),
  },
  async ({ id, ...rest }) => json(await repo.updateFinding(id, rest)),
);

// --- Evidence --------------------------------------------------------------

server.tool(
  "add_evidence",
  "Register an on-disk artifact (hashes and links it to the engagement)",
  {
    engagementId: z.string().uuid(),
    path: z.string(),
    type: z.enum(["flag", "screenshot", "scan", "output", "file"]),
    findingId: z.string().uuid().optional(),
  },
  async (input) => json(await repo.addEvidence(input)),
);

server.tool(
  "list_evidence",
  "List evidence for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listEvidence(engagementId)),
);

// --- Activity log ----------------------------------------------------------

server.tool(
  "log_activity",
  "Append to the audit trail (every notable action/command)",
  {
    engagementId: z.string().uuid(),
    phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
    action: z.string(),
    command: z.string().optional(),
    actor: z.enum(["orchestrator", "agent", "human"]).optional(),
    resultEvidenceId: z.string().uuid().optional(),
  },
  async (input) => json(await repo.logActivity(input)),
);

server.tool(
  "list_activity",
  "List the activity log for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listActivity(engagementId)),
);

// --- Knowledge base --------------------------------------------------------

server.tool(
  "search_knowledge",
  "Search the technique knowledge base (PayloadsAllTheThings, GTFObins, past findings). Use when you encounter a service, vulnerability, or escalation path and need exploitation techniques or payloads.",
  {
    query: z.string().describe("Search query, e.g. 'sudo less privilege escalation' or 'SSTI Jinja2'"),
    limit: z.number().optional().describe("Max results (default 5)"),
    source: z.string().optional().describe("Filter by source: PayloadsAllTheThings, GTFObins, etc."),
    mode: z.enum(["hybrid", "vector", "keyword"]).optional().describe("Search mode (default hybrid)"),
  },
  async ({ query, limit, source, mode }) => {
    const { searchKnowledge } = await import("@promptkiddie/core");
    const results = await searchKnowledge(query, { limit, source, mode });
    return json(results);
  },
);

// --- Agent runs ------------------------------------------------------------

server.tool(
  "start_agent_run",
  "Record the start of a sub-agent invocation",
  {
    engagementId: z.string().uuid(),
    agent: z.string(),
    phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
  },
  async (input) => json(await repo.startAgentRun(input)),
);

server.tool(
  "finish_agent_run",
  "Record the end of a sub-agent invocation",
  {
    runId: z.string().uuid(),
    status: z.enum(["ok", "failed"]),
    summary: z.string().optional(),
  },
  async (input) => json(await repo.finishAgentRun(input)),
);

// --- Inbox -----------------------------------------------------------------

server.tool(
  "list_messages",
  "List all messages for an engagement (full conversation history)",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listMessages(engagementId)),
);

server.tool(
  "poll_inbox",
  "Fetch new inbound messages and mark them read",
  { engagementId: z.string().uuid().optional() },
  async ({ engagementId }) => json(await repo.pollInbox(engagementId)),
);

server.tool(
  "send_message",
  "Send a message to the inbox",
  {
    body: z.string(),
    engagementId: z.string().uuid().optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    author: z.string().optional(),
  },
  async (input) => json(await repo.sendMessage(input)),
);

// --- Context payload ---------------------------------------------------------

server.tool(
  "get_context",
  "Get the structured LLM context payload for an engagement. Returns ports, hostnames, versions, discoveries, already-ran commands, failed attempts, findings, and artifacts with a token estimate.",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => {
    return json(await repo.getDiscoverySummary(engagementId));
  },
);

// --- Services ----------------------------------------------------------------

server.tool(
  "add_service",
  "Register a discovered service (product + version on a port). Auto-emits VersionIdentified event and logs a discovery. Call this EVERY TIME you identify a service with a version number.",
  {
    engagementId: z.string().uuid(),
    targetId: z.string().uuid(),
    port: z.number().optional(),
    protocol: z.string().optional().default("tcp"),
    name: z.string().optional().describe("Service name: http, ssh, imap, smb"),
    product: z.string().optional().describe("Product: nginx, OpenSSH, Dovecot"),
    version: z.string().optional().describe("Version: 1.24.0, 9.6p1"),
    cpe: z.string().optional(),
    banner: z.string().optional(),
    os: z.string().optional(),
    tech: z.array(z.string()).optional().describe("Tech stack: php, python, java"),
    notes: z.string().optional(),
    discoveredBy: z.string().optional(),
  },
  async (input) => json(await repo.addService(input)),
);

server.tool(
  "update_service",
  "Update a service's version, tech, notes, or other fields. Re-emits VersionIdentified if version changes.",
  {
    id: z.string().uuid(),
    version: z.string().optional(),
    name: z.string().optional(),
    product: z.string().optional(),
    cpe: z.string().optional(),
    banner: z.string().optional(),
    os: z.string().optional(),
    tech: z.array(z.string()).optional(),
    notes: z.string().optional(),
  },
  async ({ id, ...input }) => json(await repo.updateService(id, input)),
);

server.tool(
  "add_service_app",
  "Add a sub-application to a service (e.g. Roundcube on an http service). Auto-emits VersionIdentified if the app has a version.",
  {
    serviceId: z.string().uuid(),
    name: z.string().describe("Application name: OpenSTAManager, Roundcube, OliveTin"),
    version: z.string().optional(),
    path: z.string().optional().describe("URL path: /roundcube, /openstamanager"),
    tech: z.array(z.string()).optional(),
  },
  async ({ serviceId, ...app }) => json(await repo.addServiceApp(serviceId, app)),
);

server.tool(
  "add_service_cred",
  "Attach a credential to a service. Also creates an artifact for the engagement.",
  {
    serviceId: z.string().uuid(),
    username: z.string(),
    password: z.string().optional(),
    hash: z.string().optional(),
    hashType: z.string().optional().describe("bcrypt, ntlm, sha1"),
    source: z.string().describe("Where this came from: config.inc.php, NFS PDF, cracked"),
    verified: z.boolean().optional().default(false),
  },
  async ({ serviceId, ...cred }) => json(await repo.addServiceCred(serviceId, cred)),
);

server.tool(
  "add_service_cve",
  "Link a CVE to a service. If status is 'confirmed', auto-creates a finding.",
  {
    serviceId: z.string().uuid(),
    id: z.string().describe("CVE identifier: CVE-2025-69212"),
    cvss: z.number().optional(),
    severity: z.string().optional(),
    status: z.enum(["suspected", "confirmed", "not_vulnerable"]).default("suspected"),
    pocUrl: z.string().optional(),
    notes: z.string().optional(),
  },
  async ({ serviceId, ...cve }) => json(await repo.addServiceCve(serviceId, cve)),
);

server.tool(
  "list_services",
  "List services for an engagement, optionally filtered by target",
  {
    engagementId: z.string().uuid(),
    targetId: z.string().uuid().optional(),
  },
  async ({ engagementId, targetId }) =>
    json(await repo.listServices(engagementId, targetId ? { targetId } : undefined)),
);

server.tool(
  "get_service",
  "Get full service detail including linked findings",
  { id: z.string().uuid() },
  async ({ id }) => json(await repo.getService(id)),
);

server.tool(
  "list_all_creds",
  "Dump all credentials across all services for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listAllCreds(engagementId)),
);

// --- Version identification (backward compat alias) --------------------------

server.tool(
  "log_version",
  "[Deprecated: use add_service] Log a discovered product version. Calls add_service internally.",
  {
    engagementId: z.string().uuid(),
    product: z.string().describe("Product name, e.g. OpenSTAManager, nginx, OliveTin"),
    version: z.string().describe("Version string, e.g. 2.9.8, 1.24.0"),
    port: z.number().optional().describe("Port where the service was found"),
    service: z.string().optional().describe("Service name (http, ssh, etc.)"),
    targetId: z.string().uuid().optional().describe("Target UUID (auto-resolved if omitted)"),
  },
  async ({ engagementId, product, version, port, service, targetId }) => {
    let tid = targetId;
    if (!tid) {
      const targets = await repo.listTargets(engagementId) as Array<{ id: string; inScope: boolean }>;
      const target = targets.find((t) => t.inScope) ?? targets[0];
      if (!target) return { content: [{ type: "text" as const, text: "No targets found for engagement" }], isError: true };
      tid = target.id;
    }
    const row = await repo.addService({
      engagementId, targetId: tid, port, name: service, product, version,
    });

    const { searchKnowledge } = await import("@promptkiddie/core");
    const hits = await searchKnowledge(`${product} ${version}`, { limit: 3, mode: "hybrid" });

    return json({
      ...(row as Record<string, unknown>),
      knowledgeBaseHits: hits.map((h) => ({
        source: h.source,
        path: h.path,
        score: h.score,
        excerpt: h.content.slice(0, 200),
      })),
    });
  },
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
