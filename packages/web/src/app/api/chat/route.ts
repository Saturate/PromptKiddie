import { ToolLoopAgent, streamText, tool, isStepCount } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import { LangfuseExporter } from "langfuse-vercel";
import { z } from "zod";
import {
  createEngagement,
  listEngagements,
  getEngagement,
  addTarget,
  listTargets,
  addFinding,
  listFindings,
  addObjective,
  listObjectives,
  captureFlag,
  addArtifact,
  listArtifacts,
  addEvidence,
  listEvidence,
  logActivity,
  listActivity,
  sendMessage,
  listMessages,
  advancePhase,
  setEngagementStatus,
  startAgentRun,
  finishAgentRun,
  listAgentRuns,
  updateTarget,
  updateFinding,
  updateEngagement,
  getSetting,
} from "@promptkiddie/core";

export const maxDuration = 300;

const langfuseExporter = process.env.LANGFUSE_PUBLIC_KEY ? new LangfuseExporter() : null;
const telemetryConfig = langfuseExporter
  ? { isEnabled: true as const, integrations: [langfuseExporter] }
  : undefined;

async function getModelConfig() {
  const provider = ((await getSetting("chat.provider")) ?? "anthropic") as string;
  const orchestratorModel = ((await getSetting("chat.orchestrator_model")) ?? null) as string | null;
  const subagentModel = ((await getSetting("chat.subagent_model")) ?? null) as string | null;
  const baseUrl = ((await getSetting("chat.base_url")) ?? null) as string | null;

  const defaults: Record<string, { orchestrator: string; subagent: string }> = {
    anthropic: { orchestrator: "claude-opus-4-8", subagent: "claude-opus-4-8" },
    openai: { orchestrator: "gpt-4o", subagent: "gpt-4o-mini" },
    google: { orchestrator: "gemini-2.0-flash", subagent: "gemini-2.0-flash" },
    custom: { orchestrator: "gpt-4o", subagent: "gpt-4o-mini" },
  };

  const maxSteps = ((await getSetting("chat.max_steps")) ?? 0) as number;

  const d = defaults[provider] ?? defaults.anthropic;
  return {
    provider,
    orchestratorModel: orchestratorModel || d.orchestrator,
    subagentModel: subagentModel || d.subagent,
    baseUrl,
    maxSteps: maxSteps || undefined,
  };
}

function getModel(provider: string, modelId: string, baseUrl?: string | null) {
  switch (provider) {
    case "openai": return openai(modelId);
    case "google": return google(modelId);
    case "custom": {
      const custom = createOpenAICompatible({ name: "custom", baseURL: baseUrl || "http://localhost:11434/v1", apiKey: "ollama" });
      return custom.chatModel(modelId);
    }
    default: return anthropic(modelId);
  }
}

// Use z.string() instead of z.enum() for fields local models send in wrong case.
// Normalize in execute handlers. Use .passthrough() so unknown field names aren't stripped.
const pkTools = {
  createEngagement: tool({
    description: 'Create a new pentest or CTF engagement. Example: {"name": "My CTF", "type": "ctf"}',
    inputSchema: z.object({
      name: z.string().describe("Engagement name, e.g. 'Docker-CTF'"),
      type: z.string().describe("One of: ctf, whitebox, blackbox, bugbounty"),
      scope: z.string().optional().describe("Scope description"),
      brief: z.string().optional().describe("Brief / description"),
      sourceUrl: z.string().optional().describe("Source URL, e.g. a THM room URL"),
      group: z.string().optional().describe("Group name, e.g. THM"),
    }).passthrough(),
    execute: async (params) => {
      const p = { ...params, type: (params.type || "ctf").toLowerCase() };
      return createEngagement(p as Parameters<typeof createEngagement>[0]);
    },
  }),
  listEngagements: tool({
    description: "List all engagements. No parameters needed.",
    execute: async () => listEngagements(),
  }),
  getEngagement: tool({
    description: 'Get full engagement details. Example: {"id": "uuid-here"}',
    inputSchema: z.object({ id: z.string().describe("Engagement UUID") }),
    execute: async ({ id }) => {
      const eng = await getEngagement(id);
      if (!eng) return { error: "Not found" };
      return {
        engagement: eng,
        targets: await listTargets(id),
        findings: await listFindings(id),
        objectives: await listObjectives(id),
        evidence: await listEvidence(id),
        artifacts: await listArtifacts(id),
        activity: (await listActivity(id)).slice(0, 20),
        agentRuns: await listAgentRuns(id),
      };
    },
  }),
  updateEngagement: tool({
    description: 'Update engagement metadata. Example: {"id": "uuid", "brief": "new brief"}',
    inputSchema: z.object({
      id: z.string().describe("Engagement UUID"),
      name: z.string().optional(),
      brief: z.string().optional(),
      sourceUrl: z.string().optional(),
      group: z.string().optional(),
      scope: z.string().optional(),
    }),
    execute: async ({ id, ...rest }) => updateEngagement(id, rest),
  }),
  setEngagementStatus: tool({
    description: 'Set engagement status. Example: {"id": "uuid", "status": "active"}',
    inputSchema: z.object({
      id: z.string().describe("Engagement UUID"),
      status: z.string().describe("One of: scoping, active, paused, reporting, done"),
    }),
    execute: async ({ id, status }) => setEngagementStatus(id, status.toLowerCase() as Parameters<typeof setEngagementStatus>[1]),
  }),
  advancePhase: tool({
    description: 'Move engagement to a methodology phase. Example: {"id": "uuid", "phase": "recon"}',
    inputSchema: z.object({
      id: z.string().describe("Engagement UUID"),
      phase: z.string().describe("One of: scoping, recon, enum, exploit, postexploit, report"),
    }),
    execute: async ({ id, phase }) => advancePhase(id, phase.toLowerCase() as Parameters<typeof advancePhase>[1]),
  }),
  addTarget: tool({
    description: 'Add a target to an engagement. Example: {"engagementId": "uuid", "kind": "host", "identifier": "10.0.0.1", "inScope": true}',
    inputSchema: z.object({
      engagementId: z.string().describe("Engagement UUID"),
      kind: z.string().describe("One of: host, domain, url, app, repo"),
      identifier: z.string().describe("Target address, e.g. IP, domain, or URL"),
      inScope: z.boolean().optional().describe("Whether target is in scope (default false)"),
      notes: z.string().optional(),
    }).passthrough(),
    execute: async (params) => {
      const p = {
        engagementId: params.engagementId,
        kind: (params.kind || "host").toLowerCase() as Parameters<typeof addTarget>[0]["kind"],
        identifier: params.identifier || (params as Record<string, string>).target_ip || (params as Record<string, string>).target || (params as Record<string, string>).host || "",
        inScope: params.inScope ?? true,
        notes: params.notes,
      };
      return addTarget(p);
    },
  }),
  listTargets: tool({
    description: 'List targets for an engagement. Example: {"engagementId": "uuid"}',
    inputSchema: z.object({ engagementId: z.string().describe("Engagement UUID") }),
    execute: async ({ engagementId }) => listTargets(engagementId),
  }),
  updateTarget: tool({
    description: 'Update a target. Example: {"id": "uuid", "inScope": true}',
    inputSchema: z.object({ id: z.string().describe("Target UUID"), inScope: z.boolean().optional(), notes: z.string().optional() }),
    execute: async ({ id, ...rest }) => updateTarget(id, rest),
  }),
  addFinding: tool({
    description: 'Add a finding (vulnerability or flag). Example: {"engagementId": "uuid", "title": "SQL Injection", "severity": "high"}',
    inputSchema: z.object({
      engagementId: z.string().describe("Engagement UUID"),
      title: z.string().describe("Finding title"),
      severity: z.string().optional().describe("One of: critical, high, medium, low, info"),
      description: z.string().optional(),
      status: z.string().optional().describe("One of: triage, confirmed, reported"),
    }),
    execute: async (params) => {
      const p = { ...params, severity: ((params.severity || "info").toLowerCase()) as Parameters<typeof addFinding>[0]["severity"] };
      return addFinding(p as Parameters<typeof addFinding>[0]);
    },
  }),
  listFindings: tool({
    description: 'List findings for an engagement. Example: {"engagementId": "uuid"}',
    inputSchema: z.object({ engagementId: z.string().describe("Engagement UUID") }),
    execute: async ({ engagementId }) => listFindings(engagementId),
  }),
  addObjective: tool({
    description: 'Add a CTF objective/task. Example: {"engagementId": "uuid", "taskNumber": 1, "title": "Find flag 1"}',
    inputSchema: z.object({
      engagementId: z.string().describe("Engagement UUID"),
      taskNumber: z.number().describe("Task number (1, 2, 3...)"),
      title: z.string().describe("Objective title"),
      flagFormat: z.string().optional().describe("Expected flag format, e.g. FLAG{...}"),
    }),
    execute: async (params) => addObjective(params),
  }),
  captureFlag: tool({
    description: 'Capture a flag for an objective. Example: {"id": "uuid", "flag": "FLAG{secret}"}',
    inputSchema: z.object({ id: z.string().describe("Objective UUID"), flag: z.string().describe("The captured flag value") }),
    execute: async ({ id, flag }) => captureFlag(id, flag),
  }),
  addArtifact: tool({
    description: 'Add an artifact (credential, loot, document). Example: {"engagementId": "uuid", "title": "DB creds", "type": "credential", "content": "admin:password"}',
    inputSchema: z.object({
      engagementId: z.string().describe("Engagement UUID"),
      title: z.string().describe("Artifact title"),
      type: z.string().describe("One of: credential, loot, document, config, other"),
      content: z.string().optional().describe("Artifact content"),
    }),
    execute: async (params) => addArtifact(params),
  }),
  logActivity: tool({
    description: 'Log an activity entry. Example: {"engagementId": "uuid", "phase": "recon", "action": "Port scan completed"}',
    inputSchema: z.object({
      engagementId: z.string().describe("Engagement UUID"),
      phase: z.string().describe("One of: scoping, recon, enum, exploit, postexploit, report"),
      action: z.string().describe("What was done"),
      command: z.string().optional().describe("Command that was run"),
    }),
    execute: async (params) => {
      const p = { ...params, phase: params.phase.toLowerCase() as Parameters<typeof logActivity>[0]["phase"] };
      return logActivity(p);
    },
  }),
  sendMessage: tool({
    description: 'Send a message to the engagement inbox. Example: {"body": "Status update: recon complete"}',
    inputSchema: z.object({ body: z.string().describe("Message text"), engagementId: z.string().optional().describe("Engagement UUID") }),
    execute: async (params) => sendMessage(params),
  }),
  exec: tool({
    description: "Run a command on the attackbox (Docker container with security tools: nmap, nikto, gobuster, sqlmap, etc). Use for recon, scanning, and exploitation.",
    inputSchema: z.object({
      engagementId: z.string().uuid(),
      command: z.string().describe("Shell command to run"),
      phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]).optional(),
      reason: z.string().optional().describe("Why this command is being run"),
    }),
    execute: async ({ engagementId, command, phase, reason }) => {
      const { execFile } = await import("node:child_process");
      const { loadConfig } = await import("@promptkiddie/core");
      const config = loadConfig();
      const container = config.attackbox.container;

      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const proc = execFile(
          "docker", ["exec", container, "sh", "-c", command],
          { maxBuffer: 10 * 1024 * 1024, timeout: config.attackbox.timeout },
          (err, stdout, stderr) => {
            resolve({
              stdout: stdout ?? "",
              stderr: stderr ?? "",
              code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
            });
          },
        );
        proc.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 1 }));
      });

      const reasonSuffix = reason ? ` | ${reason}` : "";
      await logActivity({
        engagementId,
        phase: phase ?? "recon",
        action: `[chat] ${command.split(/\s+/)[0]} (exit ${result.code})${reasonSuffix}`,
        command,
        actor: "agent",
      });

      const output = result.stdout + result.stderr;
      const maxLen = 8192;
      if (output.length > maxLen) {
        return { output: output.slice(0, maxLen), truncated: true, totalBytes: output.length, exitCode: result.code };
      }
      return { output, exitCode: result.code };
    },
  }),
};

function buildSubAgentTool(
  name: string,
  description: string,
  systemPrompt: string,
  model: ReturnType<typeof getModel>,
) {
  return tool({
    description,
    inputSchema: z.object({
      engagementId: z.string().describe("The engagement to work on"),
      task: z.string().describe("What to do"),
    }).passthrough(),
    execute: async ({ engagementId, task }) => {
      const eng = await getEngagement(engagementId);
      const targets = await listTargets(engagementId);
      const context = `Engagement: ${eng?.name} (${engagementId})\nTargets: ${targets.map((t: { identifier: string }) => t.identifier).join(", ")}\n\nTask: ${task}`;

      await startAgentRun({ engagementId, agent: name, phase: name as "recon" });

      try {
        const result = await generateText({
          model,
          instructions: systemPrompt,
          prompt: context,
          stopWhen: isStepCount(15),
          tools: pkTools,
          telemetry: telemetryConfig,
        });
        return { summary: result.text, steps: result.steps.length };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  });
}

const ORCHESTRATOR_SYSTEM = `You are PromptKiddie, an AI pentesting orchestrator. You manage ethical hacking engagements, CTF challenges, and security research.

You have two types of tools:
1. **Database tools** for managing engagements, targets, findings, objectives, and artifacts directly.
2. **Sub-agent tools** for delegating phase-specific work (recon, enumeration, exploitation, reporting) to specialized agents.

## Workflow
- When the user describes a target or CTF, create the engagement and targets using database tools.
- For each methodology phase, delegate to the appropriate sub-agent with a clear task description.
- The sub-agents have the same database tools and will log their findings automatically.
- Review sub-agent results and decide the next phase.
- Track flags as objectives for CTF engagements.

## Phase progression
recon -> enumeration -> exploitation -> post-exploitation -> reporting

Be concise and action-oriented. Prefer delegating to sub-agents for substantial work.`;

const RECON_SYSTEM = `You are a reconnaissance specialist. Map the attack surface: discover hosts, ports, services, and technologies. Log all targets and activity to the database. Be thorough but surgical.`;
const ENUM_SYSTEM = `You are an enumeration specialist. Deepen knowledge of in-scope services: web content, parameters, auth mechanisms, default credentials. Record candidate vulnerabilities as triage findings.`;
const EXPLOIT_SYSTEM = `You are an exploitation specialist. Validate triage findings with minimal-impact PoCs. Capture proof evidence, promote findings to confirmed. For CTFs, capture flags and log them.`;
const REPORT_SYSTEM = `You are a reporting specialist. Generate findings summaries, map to ATT&CK/OWASP/CVE frameworks, and produce the engagement deliverable from the database.`;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const config = await getModelConfig();
  const orchestratorModel = getModel(config.provider, config.orchestratorModel, config.baseUrl);
  const subagentModel = getModel(config.provider, config.subagentModel, config.baseUrl);

  const subAgentTools = {
    reconAgent: buildSubAgentTool("recon", "Delegate reconnaissance work to the recon sub-agent. Example: {\"engagementId\": \"uuid\", \"task\": \"Scan all ports and grab banners\"}", RECON_SYSTEM, subagentModel),
    enumAgent: buildSubAgentTool("enum", "Delegate enumeration work to the enumeration sub-agent. Example: {\"engagementId\": \"uuid\", \"task\": \"Enumerate web directories\"}", ENUM_SYSTEM, subagentModel),
    exploitAgent: buildSubAgentTool("exploit", "Delegate exploitation work to the exploit sub-agent. Example: {\"engagementId\": \"uuid\", \"task\": \"Test SQL injection on login form\"}", EXPLOIT_SYSTEM, subagentModel),
    reportAgent: buildSubAgentTool("report", "Delegate reporting work to the report sub-agent. Example: {\"engagementId\": \"uuid\", \"task\": \"Generate findings summary\"}", REPORT_SYSTEM, subagentModel),
  };

  const result = streamText({
    model: orchestratorModel,
    instructions: ORCHESTRATOR_SYSTEM,
    messages,
    stopWhen: config.maxSteps ? isStepCount(config.maxSteps) : isStepCount(20),
    tools: { ...pkTools, ...subAgentTools },
    telemetry: telemetryConfig,
  });

  return result.toDataStreamResponse();
}
