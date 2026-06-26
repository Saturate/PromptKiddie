#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  addArtifact,
  addEvidence,
  addFinding,
  addObjective,
  addTarget,
  advancePhase,
  captureFlag,
  closeDb,
  createEngagement,
  deleteEngagement,
  getPhase,
  finishAgentRun,
  getEngagement,
  listActivity,
  listAgentRuns,
  listArtifacts,
  listEngagements,
  listMessages,
  listEvidence,
  listFindings,
  listObjectives,
  listTargets,
  logActivity,
  pollInbox,
  sendMessage,
  setEngagementStatus,
  startAgentRun,
  updateEngagement,
  updateFinding,
  updateObjective,
  updateTarget,
} from "@promptkiddie/core";

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
  async ({ name, type, scope }) => json(await createEngagement({ name, type, scope })),
);

server.tool(
  "list_engagements",
  "List all engagements",
  async () => json(await listEngagements()),
);

server.tool(
  "get_engagement",
  "Get engagement details including targets, findings, objectives, evidence, recent activity, artifacts, and agent runs",
  { id: z.string().uuid() },
  async ({ id }) => {
    const eng = await getEngagement(id);
    if (!eng) return json({ error: `No engagement with id ${id}` });
    const activity = await listActivity(id);
    return json({
      engagement: eng,
      targets: await listTargets(id),
      findings: await listFindings(id),
      objectives: await listObjectives(id),
      evidence: await listEvidence(id),
      activity: activity.slice(0, 50),
      artifacts: await listArtifacts(id),
      agentRuns: await listAgentRuns(id),
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
  async ({ id, phase }) => json(await advancePhase(id, phase)),
);

server.tool(
  "get_phase",
  "Get the current methodology phase for an engagement",
  { id: z.string().uuid() },
  async ({ id }) => json(await getPhase(id)),
);

server.tool(
  "set_engagement_status",
  "Update engagement status",
  {
    id: z.string().uuid(),
    status: z.enum(["scoping", "active", "paused", "reporting", "done"]),
  },
  async ({ id, status }) => json(await setEngagementStatus(id, status)),
);

server.tool(
  "delete_engagement",
  "Delete an engagement and all its data (cascades)",
  { id: z.string().uuid() },
  async ({ id }) => {
    const row = await deleteEngagement(id);
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
  async (input) => json(await addObjective(input)),
);

server.tool(
  "list_objectives",
  "List objectives for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listObjectives(engagementId)),
);

server.tool(
  "capture_flag",
  "Mark an objective as captured with the flag value",
  {
    id: z.string().uuid(),
    flag: z.string(),
  },
  async ({ id, flag }) => json(await captureFlag(id, flag)),
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
  async ({ id, ...rest }) => json(await updateObjective(id, rest)),
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
  async (input) => json(await addArtifact(input)),
);

server.tool(
  "list_artifacts",
  "List artifacts for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listArtifacts(engagementId)),
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
  async ({ id, ...rest }) => json(await updateEngagement(id, rest)),
);

// --- Agent runs (list) -----------------------------------------------------

server.tool(
  "list_agent_runs",
  "List agent runs for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listAgentRuns(engagementId)),
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
  async (input) => json(await addTarget(input)),
);

server.tool(
  "list_targets",
  "List targets for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listTargets(engagementId)),
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
  async ({ id, ...rest }) => json(await updateTarget(id, rest)),
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
  async (input) => json(await addFinding(input)),
);

server.tool(
  "list_findings",
  "List findings for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listFindings(engagementId)),
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
  async ({ id, ...rest }) => json(await updateFinding(id, rest)),
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
  async (input) => json(await addEvidence(input)),
);

server.tool(
  "list_evidence",
  "List evidence for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listEvidence(engagementId)),
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
  async (input) => json(await logActivity(input)),
);

server.tool(
  "list_activity",
  "List the activity log for an engagement",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listActivity(engagementId)),
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
  async (input) => json(await startAgentRun(input)),
);

server.tool(
  "finish_agent_run",
  "Record the end of a sub-agent invocation",
  {
    runId: z.string().uuid(),
    status: z.enum(["ok", "failed"]),
    summary: z.string().optional(),
  },
  async (input) => json(await finishAgentRun(input)),
);

// --- Inbox -----------------------------------------------------------------

server.tool(
  "list_messages",
  "List all messages for an engagement (full conversation history)",
  { engagementId: z.string().uuid() },
  async ({ engagementId }) => json(await listMessages(engagementId)),
);

server.tool(
  "poll_inbox",
  "Fetch new inbound messages and mark them read",
  { engagementId: z.string().uuid().optional() },
  async ({ engagementId }) => json(await pollInbox(engagementId)),
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
  async (input) => json(await sendMessage(input)),
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
