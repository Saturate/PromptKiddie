import { streamText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
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
} from "@promptkiddie/core";

export const maxDuration = 120;

const SYSTEM = `You are PromptKiddie, an AI pentesting assistant. You help with ethical hacking engagements, CTF challenges, and security research.

You have tools to manage engagements, targets, findings, objectives, artifacts, and evidence in the PromptKiddie database. Use them to track your work.

Be concise and action-oriented. When the user describes a target or task, create the engagement and targets, then start working through methodology phases: recon, enumeration, exploitation, post-exploitation, reporting.

For CTF boxes, track flags as objectives and capture them when found.`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: SYSTEM,
    messages,
    maxSteps: 10,
    tools: {
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
        parameters: z.object({
          id: z.string().uuid(),
          inScope: z.boolean().optional(),
          notes: z.string().optional(),
        }),
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
          owasp: z.array(z.string()).optional(),
          attackTechniques: z.array(z.string()).optional(),
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
        parameters: z.object({
          id: z.string().uuid(),
          flag: z.string(),
        }),
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
        parameters: z.object({
          body: z.string(),
          engagementId: z.string().uuid().optional(),
        }),
        execute: async (params) => sendMessage(params),
      }),
    },
  });

  return result.toDataStreamResponse();
}
