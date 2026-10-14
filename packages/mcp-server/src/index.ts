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

// --- Ports -------------------------------------------------------------------

server.tool(
  "add_port",
  "Record a discovered port on a target (upserts on target+port+protocol)",
  {
    targetId: z.string().uuid(),
    port: z.number(),
    protocol: z.enum(["tcp", "udp"]).optional(),
    state: z.enum(["open", "closed", "filtered"]).optional(),
    service: z.string().optional(),
    version: z.string().optional(),
    banner: z.string().optional(),
    notes: z.string().optional(),
  },
  async (input) => json(await repo.addPort(input)),
);

server.tool(
  "list_ports",
  "List ports for a target, ordered by port number",
  { targetId: z.string().uuid() },
  async ({ targetId }) => json(await repo.listPorts(targetId)),
);

server.tool(
  "update_port",
  "Update a port's state, service, version, banner, or notes",
  {
    id: z.string().uuid(),
    state: z.enum(["open", "closed", "filtered"]).optional(),
    service: z.string().optional(),
    version: z.string().optional(),
    banner: z.string().optional(),
    notes: z.string().optional(),
  },
  async ({ id, ...rest }) => json(await repo.updatePort(id, rest)),
);

// --- Webshells ---------------------------------------------------------------

server.tool(
  "register_webshell",
  "Register a deployed webshell for an engagement",
  {
    engagementId: z.string().uuid(),
    name: z.string().describe("Webshell name"),
    url: z.string().describe("Full URL to the webshell"),
    param: z.string().optional().describe("Query parameter for commands (default: cmd)"),
  },
  async ({ engagementId, ...entry }) => json(await repo.registerWebshell(engagementId, entry)),
);

server.tool(
  "list_webshells",
  "List registered webshells for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listWebshells(engagementId)),
);

server.tool(
  "get_webshell",
  "Look up a webshell by name or URL",
  {
    engagementId: z.string().uuid(),
    nameOrUrl: z.string().describe("Webshell name or URL"),
  },
  async ({ engagementId, nameOrUrl }) => json(await repo.getWebshell(engagementId, nameOrUrl)),
);

// --- Events ------------------------------------------------------------------

server.tool(
  "list_events",
  "List domain events for an engagement, optionally filtered by type",
  {
    engagementId: z.string().uuid(),
    type: z.string().optional().describe("Filter by event type"),
  },
  async ({ engagementId, type }) => json(await repo.listEvents(engagementId, type ? { type } : undefined)),
);

// --- Discoveries -------------------------------------------------------------

server.tool(
  "add_discovery",
  "Record a discovery (positive, negative, or attempted) for an engagement",
  {
    engagementId: z.string().uuid(),
    type: z.enum(["positive", "negative", "attempted"]),
    category: z.string().describe("Category: port, service, credential, vulnerability, etc."),
    summary: z.string(),
    detail: z.record(z.unknown()).optional(),
    sourceEventId: z.string().uuid().optional(),
    parentId: z.string().uuid().optional(),
  },
  async (input) => json(await repo.addDiscovery(input)),
);

server.tool(
  "list_discoveries",
  "List discoveries for an engagement, optionally filtered by category or type",
  {
    engagementId: z.string().uuid(),
    category: z.string().optional(),
    type: z.enum(["positive", "negative", "attempted"]).optional(),
  },
  async ({ engagementId, category, type }) =>
    json(await repo.listDiscoveries(engagementId, { category, type })),
);

// --- Agent log ---------------------------------------------------------------

server.tool(
  "add_agent_log",
  "Append an agent log entry for an engagement",
  {
    engagementId: z.string().uuid(),
    agent: z.string(),
    phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
    message: z.string(),
    category: z.string().optional(),
  },
  async (input) => json(await repo.addAgentLog(input)),
);

server.tool(
  "list_agent_log",
  "List agent log entries for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listAgentLog(engagementId)),
);

// --- Evidence data -----------------------------------------------------------

server.tool(
  "get_evidence_data",
  "Get the binary data, MIME type, and path for an evidence record",
  { id: z.string().uuid() },
  async ({ id }) => {
    const row = await repo.getEvidenceData(id);
    if (!row) return json({ error: `No evidence with id ${id}` });
    return json(row);
  },
);

// --- Settings ----------------------------------------------------------------

server.tool(
  "get_setting",
  "Get a platform setting by key",
  { key: z.string() },
  async ({ key }) => json(await repo.getSetting(key)),
);

server.tool(
  "set_setting",
  "Set a platform setting (upserts)",
  {
    key: z.string(),
    value: z.unknown(),
  },
  async ({ key, value }) => json(await repo.setSetting(key, value)),
);

server.tool(
  "list_settings",
  "List all platform settings",
  async () => json(await repo.getAllSettings()),
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
