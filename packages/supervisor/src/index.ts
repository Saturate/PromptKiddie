/**
 * PK Supervisor
 *
 * Event-driven process that watches engagement events via Postgres LISTEN/NOTIFY
 * and dispatches playbook actions. Not an LLM; pure code.
 *
 * Usage: pk supervisor start [--engagement <id>] [--playbook ctf]
 */
import "dotenv/config";
import { execFile } from "node:child_process";
import {
  CTF_ACTIONS,
  getRepo,
  type Action,
  type Playbook,
  type Repo,
} from "@promptkiddie/core";
import { createRunContext } from "./run-context.js";
import { EventBus } from "./event-bus.js";
import { createApiBroadcaster, connectEventStream, type ApiBroadcaster } from "./api-client.js";

const API_URL = process.env.PK_API_URL ?? "http://localhost:3200";
const API_KEY = process.env.PK_API_KEY ?? "";

/** Execution mode controls concurrency and LLM dispatch scheduling. */
export type SupervisorMode = "race" | "standard" | "methodical" | "learning";

const MODE_CONCURRENCY: Record<SupervisorMode, number> = {
  race: 5,
  standard: 3,
  methodical: 1,
  learning: 1,
};

interface PendingLlmTask {
  action: Action;
  event: { type: string; payload: Record<string, unknown>; id?: string };
}

interface SupervisorOpts {
  engagementId: string;
  playbook?: Playbook;
  mode?: SupervisorMode;
  maxConcurrent?: number;
  /** External WS broadcaster (e.g. from the API process). If omitted, creates a standalone WS server. */
  ws?: ApiBroadcaster;
  onEvent?: (event: { type: string; payload: Record<string, unknown> }) => void;
  onActionStart?: (actionName: string) => void;
  onActionEnd?: (actionName: string) => void;
  onOutput?: (actionName: string, line: string) => void;
}

const DEFAULT_IMAGE = "pk-agent";

function resolveImage(action: Action, playbook?: { meta?: { image?: string } }): string {
  return (action as { image?: string }).image ?? playbook?.meta?.image ?? DEFAULT_IMAGE;
}

async function waitForCartridge(containerName: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        execFile("docker", ["exec", containerName, "curl", "-sf", "http://localhost:4500/api/health"],
          { timeout: 3000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
      });
      if (result.includes("ok")) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Cartridge API not ready on ${containerName} after ${timeoutMs}ms`);
}

async function startCartridgeAgent(containerName: string, prompt: string, provider = "claude", model?: string): Promise<string> {
  const body: Record<string, unknown> = { provider, prompt, timeout: 3600 };
  if (model) body.options = { model };

  const result = await new Promise<string>((resolve, reject) => {
    execFile("docker", [
      "exec", containerName, "curl", "-sf",
      "-X", "POST", "http://localhost:4500/api/agents",
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify(body),
    ], { timeout: 10000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
  });

  const parsed = JSON.parse(result) as { id: string };
  return parsed.id;
}

async function spawnAgentContainer(repo: Repo, engagementId: string, image: string, target: string): Promise<string> {
  const eng = await repo.getEngagement(engagementId) as { slug: string; name: string; scope?: string; phase?: string } | null;
  if (!eng) throw new Error(`Engagement ${engagementId} not found`);

  const targets = await repo.listTargets(engagementId) as Array<{ identifier: string; inScope: boolean; notes?: string }>;
  const slug = eng.slug.replace(/[^a-zA-Z0-9_-]/g, "_");
  const containerName = `pk-agent-${slug}-${Math.random().toString(36).slice(2, 8)}`;

  const dockerArgs = [
    "run", "-d",
    "--name", containerName,
    "--network", "pk-network",
    "-e", `TARGET=${target}`,
    "-e", `TARGETS=${targets.filter(t => t.inScope).map(t => t.identifier).join(",")}`,
    "-e", `ENGAGEMENT_ID=${engagementId}`,
    "-e", `ENGAGEMENT_SLUG=${eng.slug}`,
    "-e", `PK_API_URL=${API_URL}`,
    "-e", `PK_API_KEY=${API_KEY}`,
    "-e", "PK_CONTAINER=1",
  ];

  // Write cartridge.toml so the harness inside the container can authenticate
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const configDir = "/tmp/pk-agent-configs";
  mkdirSync(configDir, { recursive: true });
  const tomlPath = join(configDir, `${containerName}.toml`);
  const tomlLines = ["[providers]"];
  if (process.env.ANTHROPIC_API_KEY) tomlLines.push(`anthropic_api_key = "${process.env.ANTHROPIC_API_KEY}"`);
  if (process.env.OPENAI_API_KEY) tomlLines.push(`openai_api_key = "${process.env.OPENAI_API_KEY}"`);
  writeFileSync(tomlPath, tomlLines.join("\n") + "\n", { mode: 0o600 });
  dockerArgs.push("-v", `${tomlPath}:/etc/cartridge/config.toml:ro`);

  // Forward auth tokens
  for (const key of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
    if (process.env[key]) dockerArgs.push("-e", `${key}=${process.env[key]}`);
  }

  // Harness selection
  const harness = process.env.PK_HARNESS ?? "claude";
  dockerArgs.push("-e", `PK_HARNESS=${harness}`);
  if (process.env.PK_MODEL) dockerArgs.push("-e", `PK_MODEL=${process.env.PK_MODEL}`);

  // /etc/hosts entries for target hostnames
  const SAFE_HOST = /^[a-zA-Z0-9.-]+$/;
  for (const t of targets.filter(t => t.inScope)) {
    if (t.notes && SAFE_HOST.test(t.notes)) {
      dockerArgs.push("--add-host", `${t.notes}:${t.identifier}`);
    }
  }

  dockerArgs.push(image);

  return new Promise((resolve, reject) => {
    execFile("docker", dockerArgs, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      console.log(`[spawn] container started: ${containerName} (${stdout.trim().slice(0, 12)})`);
      resolve(containerName);
    });
  });
}

export async function startSupervisor(opts: SupervisorOpts) {
  const repo = getRepo();
  const playbook = opts.playbook ?? CTF_ACTIONS;
  const mode: SupervisorMode = opts.mode ?? "standard";
  const maxConcurrent = opts.maxConcurrent ?? MODE_CONCURRENCY[mode];
  const activeActions = new Map<string, AbortController>();
  const bus = new EventBus();
  const priorityOverrides = new Map<string, number>();

  // Pending LLM task queue for methodical/learning modes
  const pendingLlmTasks: PendingLlmTask[] = [];
  const spawnFailures = new Map<string, number>();
  const MAX_SPAWN_RETRIES = 2;

  // Track current phase for advancement logic
  let currentPhase = "scoping";

  function getActionPriority(action: Action): number {
    return priorityOverrides.get(action.name) ?? 50;
  }

  /** Returns true if an action is prompt-only (LLM tier, no script). */
  function isPromptOnly(action: Action): boolean {
    return !action.run && !!action.prompt;
  }

  // WebSocket: use external broadcaster if provided, otherwise create standalone
  const ownsWs = !opts.ws;
  const ws: ApiBroadcaster = opts.ws ?? createApiBroadcaster(opts.engagementId);

  // Wrap caller-provided callbacks so they also broadcast over WebSocket
  const origOnEvent = opts.onEvent;
  opts.onEvent = (event) => {
    ws.sendEvent(event);
    origOnEvent?.(event);
  };
  const origOnActionStart = opts.onActionStart;
  opts.onActionStart = (name) => {
    ws.sendActionStart(name);
    origOnActionStart?.(name);
  };
  const origOnActionEnd = opts.onActionEnd;
  opts.onActionEnd = (name) => {
    ws.sendActionEnd(name);
    origOnActionEnd?.(name);
  };
  const origOnOutput = opts.onOutput;
  opts.onOutput = (actionName, line) => {
    ws.sendOutput(actionName, line);
    origOnOutput?.(actionName, line);
  };

  const engOrNull = await repo.getEngagement(opts.engagementId) as { name: string; type: string; phase?: string; slug: string } | null;
  if (!engOrNull) throw new Error(`Engagement ${opts.engagementId} not found`);
  const engagement = engOrNull;
  currentPhase = engagement.phase ?? "scoping";

  const targets = await repo.listTargets(opts.engagementId) as Array<{ identifier: string; inScope: boolean; notes?: string }>;
  const primaryTarget = targets.find((t) => t.inScope)?.identifier ?? targets[0]?.identifier ?? "unknown";

  // Track completed actions to avoid re-running the same work on resume.
  // Seeded from activity log so restarting the supervisor doesn't re-run
  // actions that already completed in a previous session.
  const completedActions = new Set<string>();

  // Seed from existing activity: "[action_name] tool (...)" entries
  try {
    const activity = await repo.listActivity(opts.engagementId) as Array<{ action: string }>;
    const events = await repo.listEvents(opts.engagementId) as Array<{ type: string }>;
    const eventTypes = new Set(events.map(e => e.type));
    for (const a of activity) {
      const match = a.action.match(/^\[(\w+)\]/);
      if (match) {
        const actionName = match[1];
        for (const et of eventTypes) {
          completedActions.add(`${actionName}:${et}`);
        }
      }
    }
    if (completedActions.size > 0) {
      console.log(`[supervisor] resumed with ${completedActions.size} completed action:event pairs`);
    }
  } catch {}

  console.log(`[supervisor] starting for "${engagement.name}" (${opts.engagementId})`);
  console.log(`[supervisor] mode: ${mode} (maxConcurrent: ${maxConcurrent})`);
  console.log(`[supervisor] target: ${primaryTarget}`);
  console.log(`[supervisor] playbook: ${playbook.name} (${playbook.actions.length} actions)`);

  // Spawn persistent worker container for script actions (ctx.exec)
  let workerContainer: string | null = null;
  const workerImage = playbook.meta?.image ?? DEFAULT_IMAGE;
  const slug = engagement.slug.replace(/[^a-zA-Z0-9_-]/g, "_");
  const workerName = `pk-worker-${slug}`;

  try {
    // Check if a worker already exists
    const existing = await new Promise<string>((resolve, reject) => {
      execFile("docker", ["ps", "-aq", "--filter", `name=^/${workerName}$`], { timeout: 5000 },
        (err, stdout) => err ? reject(err) : resolve((stdout ?? "").trim()));
    });

    if (existing) {
      await new Promise<void>((resolve) => {
        execFile("docker", ["start", workerName], { timeout: 10000 }, () => resolve());
      });
      workerContainer = workerName;
      console.log(`[supervisor] worker container reused: ${workerName}`);
    } else {
      const dockerArgs = [
        "run", "-d",
        "--name", workerName,
      ];
      // Try Docker network; ignore if it doesn't exist
      const networkName = playbook.meta?.network ?? "pk-network";
      try {
        await new Promise<void>((resolve, reject) => {
          execFile("docker", ["network", "inspect", networkName], { timeout: 3000 },
            (err) => err ? reject(err) : resolve());
        });
        dockerArgs.push("--network", networkName);
      } catch { /* network doesn't exist, skip */ }

      dockerArgs.push(
        "-e", `TARGET=${primaryTarget}`,
        "-e", `ENGAGEMENT_ID=${opts.engagementId}`,
        "-e", `PK_API_URL=${API_URL}`,
      );

      const SAFE_HOST = /^[a-zA-Z0-9.-]+$/;
      for (const t of targets.filter(t => t.inScope)) {
        if (t.notes && SAFE_HOST.test(t.notes)) {
          dockerArgs.push("--add-host", `${t.notes}:${t.identifier}`);
        }
      }

      dockerArgs.push(workerImage, "sleep", "infinity");

      await new Promise<void>((resolve, reject) => {
        execFile("docker", dockerArgs, { timeout: 30000 }, (err, _stdout, stderr) => {
          if (err) { reject(new Error(stderr || err.message)); return; }
          resolve();
        });
      });
      workerContainer = workerName;
      console.log(`[supervisor] worker container started: ${workerName}`);
    }
  } catch (err) {
    console.error(`[supervisor] worker spawn failed: ${err instanceof Error ? err.message : err}`);
  }

  // Spawn persistent orchestrator container (LLM sidekick)
  let orchContainer: string | null = null;
  const orchName = `pk-orch-${slug}`;

  try {
    const existing = await new Promise<string>((resolve, reject) => {
      execFile("docker", ["ps", "-aq", "--filter", `name=^/${orchName}$`], { timeout: 5000 },
        (err, stdout) => err ? reject(err) : resolve((stdout ?? "").trim()));
    });

    if (existing) {
      // Remove stale container; orchestrator needs a fresh Cartridge session
      await new Promise<void>((resolve) => {
        execFile("docker", ["rm", "-f", orchName], { timeout: 10000 }, () => resolve());
      });
    }
    {
      const orchImage = playbook.meta?.image ?? DEFAULT_IMAGE;
      const orchDockerArgs = [
        "run", "-d",
        "--name", orchName,
        "-e", `TARGET=${primaryTarget}`,
        "-e", `TARGETS=${targets.filter(t => t.inScope).map(t => t.identifier).join(",")}`,
        "-e", `ENGAGEMENT_ID=${opts.engagementId}`,
        "-e", `ENGAGEMENT_SLUG=${engagement.slug}`,
        "-e", `PK_API_URL=${API_URL}`,
        "-e", `PK_API_KEY=${API_KEY}`,
        "-e", "PK_ROLE=orchestrator",
      ];

      // Docker network
      const networkName = playbook.meta?.network ?? "pk-network";
      try {
        await new Promise<void>((resolve, reject) => {
          execFile("docker", ["network", "inspect", networkName], { timeout: 3000 },
            (err) => err ? reject(err) : resolve());
        });
        orchDockerArgs.push("--network", networkName);
      } catch {}

      // Forward auth tokens
      for (const key of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
        if (process.env[key]) orchDockerArgs.push("-e", `${key}=${process.env[key]}`);
      }

      // Harness selection
      const harness = process.env.PK_HARNESS ?? "claude";
      orchDockerArgs.push("-e", `PK_HARNESS=${harness}`);
      if (process.env.PK_MODEL) orchDockerArgs.push("-e", `PK_MODEL=${process.env.PK_MODEL}`);

      // /etc/hosts for target hostnames
      const SAFE_HOST_ORCH = /^[a-zA-Z0-9.-]+$/;
      for (const t of targets.filter(t => t.inScope)) {
        if (t.notes && SAFE_HOST_ORCH.test(t.notes)) {
          orchDockerArgs.push("--add-host", `${t.notes}:${t.identifier}`);
        }
      }

      orchDockerArgs.push(orchImage);

      await new Promise<void>((resolve, reject) => {
        execFile("docker", orchDockerArgs, { timeout: 60000 }, (err, _stdout, stderr) => {
          if (err) { reject(new Error(stderr || err.message)); return; }
          resolve();
        });
      });
      orchContainer = orchName;
      console.log(`[supervisor] orchestrator started: ${orchName}`);

      // Switch CLAUDE.md -> ORCHESTRATOR.md inside the container
      await new Promise<void>((resolve) => {
        execFile("docker", ["exec", orchName, "ln", "-sf", "ORCHESTRATOR.md", "/workspace/CLAUDE.md"], { timeout: 5000 }, () => resolve());
      });

      // Wait for Cartridge API, then start the orchestrator agent
      try {
        await waitForCartridge(orchName);
        const orchProvider = process.env.PK_HARNESS ?? "claude";
        const orchModel = (playbook.meta as Record<string, unknown>)?.orchestratorModel as string | undefined
          ?? process.env.PK_MODEL
          ?? undefined;

        const context = await repo.getDiscoverySummary(opts.engagementId) as Record<string, unknown>;
        const orchPrompt = [
          `You are the orchestrator for "${engagement.name}" (${engagement.type}).`,
          `Target: ${primaryTarget}. Phase: ${currentPhase}.`,
          context ? `\nEngagement state:\n${JSON.stringify(context, null, 2).slice(0, 2000)}` : "",
          "\nWatch for events. Intervene when progress stalls. Read CLAUDE.md for full instructions.",
        ].join("\n");

        const orchAgentId = await startCartridgeAgent(orchName, orchPrompt, orchProvider, orchModel);
        console.log(`[supervisor] orchestrator agent: ${orchName} (${orchAgentId})`);

        // Register PTY alias
        try {
          await new Promise<void>((res, rej) => {
            execFile("curl", ["-sf", "-X", "POST",
              `${API_URL}/api/agents/${orchAgentId}/alias`,
              "-H", "Content-Type: application/json",
              "-d", JSON.stringify({ container: orchName, action: "orchestrator", image: orchImage, engagementId: opts.engagementId }),
            ], { timeout: 5000 }, (err) => err ? rej(err) : res());
          });
        } catch {}
      } catch (err) {
        console.error(`[supervisor] orchestrator agent failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    console.error(`[supervisor] orchestrator spawn failed: ${err instanceof Error ? err.message : err}`);
  }

  async function dispatchAction(action: Action, event: { type: string; payload: Record<string, unknown>; id?: string }) {
    if (activeActions.size >= maxConcurrent) {
      console.log(`[supervisor] queued: ${action.name} (${activeActions.size}/${maxConcurrent} running)`);
      bus.once(`slot_free`, () => dispatchAction(action, event));
      return;
    }

    const ac = new AbortController();
    activeActions.set(`${action.name}-${Date.now()}`, ac);
    opts.onActionStart?.(action.name);
    console.log(`[supervisor] running: ${action.name} (triggered by ${event.type})`);

    try {
      if (action.run) {
        const ctx = createRunContext({
          engagementId: opts.engagementId,
          target: primaryTarget,
          repo,
          actionName: action.name,
          containerName: workerContainer ?? undefined,
          event: {
            id: event.id ?? `evt-${Date.now()}`,
            type: event.type,
            payload: event.payload,
            source: "supervisor",
            engagementId: opts.engagementId,
            createdAt: new Date(),
          },
          engagement: {
            id: opts.engagementId,
            name: engagement.name,
            type: engagement.type,
            target: primaryTarget,
            phase: currentPhase,
            mode,
          },
          onReprioritize: (name, priority) => {
            priorityOverrides.set(name, priority);
            console.log(`[supervisor] reprioritized: ${name} -> p${priority}`);
          },
          onOutput: (line) => opts.onOutput?.(action.name, line),
          signal: ac.signal,
        });

        await action.run(ctx);
      }

      if (action.prompt && !action.run) {
        const agentImage = resolveImage(action, playbook);
        const failKey = `${action.name}:${agentImage}`;
        const priorFails = spawnFailures.get(failKey) ?? 0;

        if (priorFails >= MAX_SPAWN_RETRIES) {
          console.log(`[supervisor] skipping "${action.name}" (spawn failed ${priorFails}x for ${agentImage})`);
          return;
        }

        console.log(`[supervisor] agent action "${action.name}" -> spawning ${agentImage}`);

        if (mode === "learning") {
          console.log(`[supervisor] learning mode: action "${action.name}" wants to spawn ${agentImage}`);
        }

        // Interpolate template variables in the prompt
        const interpolated = action.prompt.replace(/\{(\w+)\}/g, (_: string, key: string) => {
          return String(event.payload[key] ?? `{${key}}`);
        });

        try {
          const containerName = await spawnAgentContainer(repo, opts.engagementId, agentImage, primaryTarget);
          console.log(`[supervisor] spawned: ${containerName}`);

          // Wait for Cartridge API, then start agent with prompt
          const provider = process.env.PK_HARNESS ?? "claude";
          const model = process.env.PK_MODEL || undefined;
          await waitForCartridge(containerName);
          const agentId = await startCartridgeAgent(containerName, interpolated, provider, model);
          console.log(`[supervisor] agent started: ${containerName} (${agentId})`);

          // Register PTY alias + metadata so the web panel can connect by container name
          try {
            await new Promise<void>((res, rej) => {
              execFile("curl", ["-sf", "-X", "POST",
                `${API_URL}/api/agents/${agentId}/alias`,
                "-H", "Content-Type: application/json",
                "-d", JSON.stringify({ container: containerName, action: action.name, image: agentImage, engagementId: opts.engagementId }),
              ], { timeout: 5000 }, (err) => err ? rej(err) : res());
            });
          } catch {}

          await repo.addDiscovery({
            engagementId: opts.engagementId,
            type: "attempted",
            category: "agent",
            summary: `Agent "${action.name}" started as ${containerName} (${agentImage}, ${agentId})`,
          });

          ws.sendEvent({ type: "AgentSpawned", payload: { action: action.name, container: containerName, image: agentImage, agentId } });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          spawnFailures.set(failKey, priorFails + 1);
          console.error(`[supervisor] spawn failed for "${action.name}" (${priorFails + 1}/${MAX_SPAWN_RETRIES}): ${msg}`);
          await repo.addDiscovery({
            engagementId: opts.engagementId,
            type: "negative",
            category: "agent",
            summary: `Agent spawn failed for "${action.name}": ${msg}`,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[supervisor] action "${action.name}" failed: ${msg}`);
      await repo.addDiscovery({
        engagementId: opts.engagementId,
        type: "negative",
        category: "error",
        summary: `Action "${action.name}" failed: ${msg}`,
      });
    } finally {
      const key = [...activeActions.entries()].find(([k]) => k.startsWith(action.name))?.[0];
      if (key) activeActions.delete(key);
      completedActions.add(`${action.name}:${event.type}`);
      opts.onActionEnd?.(action.name);
      bus.emit("slot_free", {});
    }
  }

  /** Try to advance the engagement phase based on event type. */
  async function maybeAdvancePhase(event: { type: string; payload: Record<string, unknown> }) {
    const eid = opts.engagementId;
    try {
      let targetPhase: string | null = null;

      if (event.type === "PortDiscovered" && currentPhase === "recon") {
        // Only advance if no recon actions are still running
        const reconRunning = [...activeActions.keys()].some(
          (k) => k.startsWith("port_scan") || k.startsWith("udp_scan"),
        );
        if (!reconRunning) targetPhase = "enum";
      } else if (event.type === "FindingAdded" && (currentPhase === "recon" || currentPhase === "enum")) {
        targetPhase = "exploit";
      } else if (event.type === "ShellObtained" && currentPhase !== "postexploit" && currentPhase !== "report") {
        targetPhase = "postexploit";
      } else if (event.type === "FlagCaptured") {
        // Advance to report only if this looks like the final flag
        // (heuristic: root flag captured)
        if (event.payload.type === "root") targetPhase = "report";
      }

      if (targetPhase && targetPhase !== currentPhase) {
        const result = await repo.advancePhase(eid, targetPhase) as { warning?: string };
        currentPhase = targetPhase;
        console.log(`[supervisor] phase advanced: ${currentPhase}${result.warning ? ` (${result.warning})` : ""}`);
        ws.sendEvent({ type: "PhaseAdvanced", payload: { phase: currentPhase } });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[supervisor] phase advance failed: ${msg}`);
    }
  }

  function evaluateAndDispatch(event: { type: string; payload: Record<string, unknown>; id?: string }) {
    opts.onEvent?.(event);

    const matched: Action[] = [];
    for (const action of playbook.actions) {
      try {
        const synthetic = {
          id: event.id ?? `evt-${Date.now()}`,
          type: event.type,
          payload: event.payload,
          source: "supervisor",
          engagementId: opts.engagementId,
          createdAt: new Date(),
        };

        if (action.on(synthetic)) {
          matched.push(action);
        }
      } catch {
        // trigger threw; skip
      }
    }

    matched.sort((a, b) => getActionPriority(a) - getActionPriority(b));

    // Filter out actions that already completed for this event type.
    // Events with payload.force=true bypass this check.
    const force = event.payload?.force === true;
    const fresh = force ? matched : matched.filter((action) => {
      const key = `${action.name}:${event.type}`;
      if (completedActions.has(key)) {
        console.log(`[supervisor] skipping "${action.name}" (already completed for ${event.type})`);
        return false;
      }
      return true;
    });
    if (force && matched.length > 0) {
      console.log(`[supervisor] force flag: re-running ${matched.length} action(s) for ${event.type}`);
    }

    for (const action of fresh) {
      // In methodical/learning modes, prompt-only actions are queued
      if ((mode === "methodical" || mode === "learning") && isPromptOnly(action)) {
        pendingLlmTasks.push({ action, event });
        console.log(`[supervisor] queued LLM task: ${action.name} (mode: ${mode}, pending: ${pendingLlmTasks.length})`);
        continue;
      }
      dispatchAction(action, event);
    }

    // Phase advancement (async, fire-and-forget; errors are logged)
    maybeAdvancePhase(event);
  }

  /**
   * Release pending LLM tasks from the queue. In methodical mode the
   * orchestrator calls this via CLI or HTTP to approve queued agent work.
   * In learning mode, tasks are released after human inbox approval.
   *
   * @param count - Number of tasks to release. Default: all pending tasks.
   * @returns The names of released actions.
   */
  function releasePending(count?: number): string[] {
    const toRelease = count != null ? pendingLlmTasks.splice(0, count) : pendingLlmTasks.splice(0);
    const released: string[] = [];
    for (const task of toRelease) {
      console.log(`[supervisor] releasing pending LLM task: ${task.action.name}`);
      dispatchAction(task.action, task.event);
      released.push(task.action.name);
    }
    return released;
  }

  // Connect to API WebSocket for event streaming
  let closing = false;
  const eventStream = connectEventStream(opts.engagementId, (event) => {
    if (closing) return;
    evaluateAndDispatch({ type: event.type, payload: event.payload, id: event.id });
  });
  console.log("[supervisor] connecting to event stream");

  // Fire EngagementStarted only on first run (skip if engagement already has events)
  
  const priorEvents = await repo.listEvents(opts.engagementId, { type: "EngagementStarted" });
  if (priorEvents.length === 0) {
    console.log("[supervisor] emitting EngagementStarted");
    await repo.emitEvent(opts.engagementId, "EngagementStarted", { target: primaryTarget }, "supervisor");
  } else {
    console.log("[supervisor] resuming (EngagementStarted already emitted, skipping)");
  }

  const cleanup = async () => {
    closing = true;
    for (const [, ac] of activeActions) ac.abort();
    if (ownsWs) await ws.close();
    eventStream.close();
    if (workerContainer) {
      execFile("docker", ["stop", workerContainer], { timeout: 10000 }, () => {});
    }
    if (orchContainer) {
      execFile("docker", ["stop", orchContainer], { timeout: 10000 }, () => {});
    }
  };

  const shutdown = async () => {
    console.log("\n[supervisor] shutting down...");
    await cleanup();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return {
    stop: cleanup,
    cleanup,
    dispatch: evaluateAndDispatch,
    releasePending,
    get pendingCount() { return pendingLlmTasks.length; },
    mode,
    ws,
  };
}

/** Standby mode: one supervisor per active engagement, auto-start/stop on status changes. */
export interface StandbyOpts {
  mode?: SupervisorMode;
  /** External WS broadcaster shared across all supervisor instances. */
  ws?: ApiBroadcaster;
}

export async function startStandby(opts: StandbyOpts = {}) {
  const activeSupervisors = new Map<string, { stop: () => Promise<void> }>();

  async function ensureSupervisor(engId: string) {
    if (activeSupervisors.has(engId)) return;
    console.log(`[supervisor] starting for engagement ${engId}`);
    const sup = await startSupervisor({ engagementId: engId, mode: opts.mode, ws: opts.ws });
    activeSupervisors.set(engId, sup);
  }

  async function stopSupervisorFor(engId: string) {
    const sup = activeSupervisors.get(engId);
    if (!sup) return;
    console.log(`[supervisor] stopping for engagement ${engId}`);
    await sup.stop();
    activeSupervisors.delete(engId);
  }

  const standbyRepo = getRepo();

  const existing = await standbyRepo.listEngagements() as Array<{ id: string; status: string }>;
  const active = existing.filter((e) => e.status === "active");
  console.log(`[supervisor] standby mode - ${active.length} active engagement(s), listening for new ones...`);
  for (const eng of active) {
    await ensureSupervisor(eng.id).catch((err: Error) =>
      console.error(`[supervisor] failed to resume ${eng.id}:`, err.message));
  }

  // Subscribe to all events (no engagementId filter) for standby routing
  const standbyStream = connectEventStream("", async (event) => {
    const engId = (event as Record<string, unknown>).engagementId as string | undefined
      ?? (event as Record<string, unknown>).engagement_id as string | undefined;
    if (!engId) return;

    try {
      if (event.type === "EngagementStarted") {
        await ensureSupervisor(engId);
      } else if (event.type === "StatusChanged") {
        const payload = event.payload as { status?: string };
        if (payload.status === "active") {
          await ensureSupervisor(engId);
        } else if (payload.status === "paused" || payload.status === "done") {
          await stopSupervisorFor(engId);
        }
      }
    } catch {}
  });

  const shutdown = async () => {
    console.log("[supervisor] shutting down all instances...");
    for (const [, sup] of activeSupervisors) await sup.stop();
    standbyStream.close();
  };

  return {
    shutdown,
    get activeCount() { return activeSupervisors.size; },
    get activeEngagements() { return [...activeSupervisors.keys()]; },
  };
}

// CLI entry point (only when run directly, not when imported)
const isDirectRun = process.argv[1]?.includes("supervisor");
if (isDirectRun) {
  const standby = process.argv.includes("--standby");
  const modeArgIdx = process.argv.indexOf("--mode");
  const cliMode = modeArgIdx >= 0 ? (process.argv[modeArgIdx + 1] as SupervisorMode | undefined) : undefined;
  const validModes: SupervisorMode[] = ["race", "standard", "methodical", "learning"];
  if (cliMode && !validModes.includes(cliMode)) {
    console.error(`Invalid mode "${cliMode}". Valid modes: ${validModes.join(", ")}`);
    process.exit(1);
  }

  if (standby) {
    startStandby({ mode: cliMode }).then((s) => {
      process.on("SIGINT", async () => { await s.shutdown(); process.exit(0); });
      process.on("SIGTERM", async () => { await s.shutdown(); process.exit(0); });
    }).catch((err) => {
      console.error("[supervisor] standby failed:", err);
      process.exit(1);
    });
  } else {
    const engagementId = process.argv[2];
    if (!engagementId) {
      console.error("Usage: pk supervisor <engagement-id> [--mode race|standard|methodical|learning]");
      console.error("       pk supervisor --standby [--mode ...]");
      process.exit(1);
    }

    startSupervisor({ engagementId, mode: cliMode }).catch((err) => {
      console.error("[supervisor] fatal:", err);
      process.exit(1);
    });
  }
}
