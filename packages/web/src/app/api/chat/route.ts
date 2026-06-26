import { ToolLoopAgent, streamText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
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

const langfuseEnabled = !!process.env.LANGFUSE_PUBLIC_KEY;
const telemetryConfig = langfuseEnabled
  ? { isEnabled: true, tracer: new LangfuseExporter() }
  : undefined;

async function getModelConfig() {
  const provider = ((await getSetting("chat.provider")) ?? "anthropic") as string;
  const orchestratorModel = ((await getSetting("chat.orchestrator_model")) ?? null) as string | null;
  const subagentModel = ((await getSetting("chat.subagent_model")) ?? null) as string | null;
  const maxSteps = ((await getSetting("chat.max_steps")) ?? 20) as number;

  const defaults: Record<string, { orchestrator: string; subagent: string }> = {
    anthropic: { orchestrator: "claude-opus-4-8", subagent: "claude-sonnet-4-6" },
    openai: { orchestrator: "gpt-4o", subagent: "gpt-4o-mini" },
    google: { orchestrator: "gemini-2.0-flash", subagent: "gemini-2.0-flash" },
    ollama: { orchestrator: "llama3", subagent: "llama3" },
  };

  const d = defaults[provider] ?? defaults.anthropic;
  return {
    provider,
    orchestratorModel: orchestratorModel || d.orchestrator,
    subagentModel: subagentModel || d.subagent,
    maxSteps,
  };
}

function getModel(provider: string, modelId: string) {
  switch (provider) {
    case "openai": return openai(modelId);
    case "google": return google(modelId);
    default: return anthropic(modelId);
  }
}

const pkTools = {
  createEngagement: tool({
    description: "Create a new engagement (CTF, whitebox, blackbox, or bugbounty)",
    parameters: z.object({
      name: z.string(),
      type: z.enum(["ctf", "whitebox", "blackbox", "bugbounty"]),
      scope: z.string().optional(),
      brief: z.string().optional(),
      sourceUrl: z.string().optional(),
      group: z.string().optional(),
    }),
    execute: async (params) => createEngagement(params),
  }),
  listEngagements: tool({
    description: "List all engagements",
    parameters: z.object({}),
    execute: async () => listEngagements(),
  }),
  getEngagement: tool({
    description: "Get full engagement details including targets, findings, objectives",
    parameters: z.object({ id: z.string().uuid() }),
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
    description: "Update engagement metadata",
    parameters: z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      brief: z.string().optional(),
      sourceUrl: z.string().optional(),
      group: z.string().optional(),
      scope: z.string().optional(),
    }),
    execute: async ({ id, ...rest }) => updateEngagement(id, rest),
  }),
  setEngagementStatus: tool({
    description: "Set engagement status",
    parameters: z.object({
      id: z.string().uuid(),
      status: z.enum(["scoping", "active", "paused", "reporting", "done"]),
    }),
    execute: async ({ id, status }) => setEngagementStatus(id, status),
  }),
  advancePhase: tool({
    description: "Move engagement to a methodology phase",
    parameters: z.object({
      id: z.string().uuid(),
      phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
    }),
    execute: async ({ id, phase }) => advancePhase(id, phase),
  }),
  addTarget: tool({
    description: "Add a target to an engagement",
    parameters: z.object({
      engagementId: z.string().uuid(),
      kind: z.enum(["host", "domain", "url", "app", "repo"]),
      identifier: z.string(),
      inScope: z.boolean().optional(),
      notes: z.string().optional(),
    }),
    execute: async (params) => addTarget(params),
  }),
  listTargets: tool({
    description: "List targets for an engagement",
    parameters: z.object({ engagementId: z.string().uuid() }),
    execute: async ({ engagementId }) => listTargets(engagementId),
  }),
  updateTarget: tool({
    description: "Update a target",
    parameters: z.object({ id: z.string().uuid(), inScope: z.boolean().optional(), notes: z.string().optional() }),
    execute: async ({ id, ...rest }) => updateTarget(id, rest),
  }),
  addFinding: tool({
    description: "Add a finding (vulnerability or flag)",
    parameters: z.object({
      engagementId: z.string().uuid(),
      title: z.string(),
      severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
      description: z.string().optional(),
      status: z.enum(["triage", "confirmed", "reported"]).optional(),
    }),
    execute: async (params) => addFinding(params),
  }),
  listFindings: tool({
    description: "List findings for an engagement",
    parameters: z.object({ engagementId: z.string().uuid() }),
    execute: async ({ engagementId }) => listFindings(engagementId),
  }),
  addObjective: tool({
    description: "Add a CTF objective/task",
    parameters: z.object({
      engagementId: z.string().uuid(),
      taskNumber: z.number(),
      title: z.string(),
      flagFormat: z.string().optional(),
    }),
    execute: async (params) => addObjective(params),
  }),
  captureFlag: tool({
    description: "Capture a flag for an objective",
    parameters: z.object({ id: z.string().uuid(), flag: z.string() }),
    execute: async ({ id, flag }) => captureFlag(id, flag),
  }),
  addArtifact: tool({
    description: "Add an artifact (credential, loot, document)",
    parameters: z.object({
      engagementId: z.string().uuid(),
      title: z.string(),
      type: z.string(),
      content: z.string().optional(),
    }),
    execute: async (params) => addArtifact(params),
  }),
  logActivity: tool({
    description: "Log an activity entry",
    parameters: z.object({
      engagementId: z.string().uuid(),
      phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
      action: z.string(),
      command: z.string().optional(),
    }),
    execute: async (params) => logActivity(params),
  }),
  sendMessage: tool({
    description: "Send a message to the engagement inbox",
    parameters: z.object({ body: z.string(), engagementId: z.string().uuid().optional() }),
    execute: async (params) => sendMessage(params),
  }),
  exec: tool({
    description: "Run a command on the attackbox (Docker container with security tools: nmap, nikto, gobuster, sqlmap, etc). Use for recon, scanning, and exploitation.",
    parameters: z.object({
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
  const agent = new ToolLoopAgent({
    model,
    instructions: systemPrompt,
    tools: pkTools,
  });

  return tool({
    description,
    parameters: z.object({
      engagementId: z.string().uuid().describe("The engagement to work on"),
      task: z.string().describe("What to do"),
    }),
    execute: async ({ engagementId, task }, { abortSignal }) => {
      const eng = await getEngagement(engagementId);
      const targets = await listTargets(engagementId);
      const context = `Engagement: ${eng?.name} (${engagementId})\nTargets: ${targets.map((t: { identifier: string }) => t.identifier).join(", ")}\n\nTask: ${task}`;

      await startAgentRun({ engagementId, agent: name, phase: name as "recon" });

      try {
        const result = await agent.generate({ prompt: context, abortSignal, experimental_telemetry: telemetryConfig });
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
  const orchestratorModel = getModel(config.provider, config.orchestratorModel);
  const subagentModel = getModel(config.provider, config.subagentModel);

  const subAgentTools = {
    reconAgent: buildSubAgentTool("recon", "Delegate reconnaissance work to the recon sub-agent", RECON_SYSTEM, subagentModel),
    enumAgent: buildSubAgentTool("enum", "Delegate enumeration work to the enumeration sub-agent", ENUM_SYSTEM, subagentModel),
    exploitAgent: buildSubAgentTool("exploit", "Delegate exploitation work to the exploit sub-agent", EXPLOIT_SYSTEM, subagentModel),
    reportAgent: buildSubAgentTool("report", "Delegate reporting work to the report sub-agent", REPORT_SYSTEM, subagentModel),
  };

  const result = streamText({
    model: orchestratorModel,
    system: ORCHESTRATOR_SYSTEM,
    messages,
    maxSteps: config.maxSteps,
    tools: { ...pkTools, ...subAgentTools },
    experimental_telemetry: telemetryConfig,
  });

  return result.toDataStreamResponse();
}
