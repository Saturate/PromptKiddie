#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeDb, getRepo } from "@promptkiddie/core";

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
  "Create a new engagement (CTF, whitebox, blackbox, or bugbounty)",
  {
    name: z.string(),
    type: z.enum(["ctf", "whitebox", "blackbox", "bugbounty"]),
    scope: z.string().optional(),
  },
  async ({ name, type, scope }) => json(await repo.createEngagement({ name, type, scope })),
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

// --- Playbook steps -------------------------------------------------------

server.tool(
  "list_steps",
  "List all playbook steps for an engagement with their status",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await repo.listEngagementSteps(engagementId)),
);

server.tool(
  "get_next_steps",
  "Evaluate the playbook graph: auto-skip nodes whose conditions are false, return ready nodes sorted by priority, and report progress. Use this to decide what to execute next.",
  {
    engagementId: z.string().uuid(),
    maxSteps: z.number().optional().describe("Max ready nodes to return (default 5)"),
  },
  async ({ engagementId, maxSteps }) => json(await repo.getNextSteps(engagementId, maxSteps)),
);

server.tool(
  "start_step",
  "Mark a playbook step as running (sets startedAt, agentId). Call before executing a step so it glows amber in the UI.",
  {
    engagementId: z.string().uuid(),
    stepKey: z.string().describe("Step key, e.g. recon.tcp_scan"),
    agentId: z.string().optional().describe("ID of the agent executing this step"),
  },
  async ({ engagementId, stepKey, agentId }) => json(await repo.startStep(engagementId, stepKey, agentId)),
);

server.tool(
  "complete_step",
  "Mark a playbook step as done. Call after the step's work is finished.",
  {
    engagementId: z.string().uuid(),
    stepKey: z.string().describe("Step key, e.g. recon.tcp_scan"),
    resultType: z.string().optional().describe("What was produced: port, finding, evidence, activity"),
    resultId: z.string().uuid().optional().describe("UUID of the result row"),
  },
  async ({ engagementId, stepKey, resultType, resultId }) =>
    json(await repo.completeStep(engagementId, stepKey, resultType && resultId ? { type: resultType, id: resultId } : undefined)),
);

server.tool(
  "skip_step",
  "Skip a playbook step with a reason. Use when a step is not applicable.",
  {
    engagementId: z.string().uuid(),
    stepKey: z.string().describe("Step key to skip"),
    reason: z.string().describe("Why this step is being skipped"),
  },
  async ({ engagementId, stepKey, reason }) => json(await repo.skipStep(engagementId, stepKey, reason)),
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

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  closeDb().then(() => process.exit(1));
});

process.on("SIGINT", () => closeDb().then(() => process.exit(0)));
process.on("SIGTERM", () => closeDb().then(() => process.exit(0)));
