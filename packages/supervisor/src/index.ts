/**
 * PK Supervisor
 *
 * Event-driven process that watches engagement events via Postgres LISTEN/NOTIFY
 * and dispatches playbook actions. Not an LLM; pure code.
 *
 * Usage: pk supervisor start [--engagement <id>] [--playbook ctf]
 */
import "dotenv/config";
import { Client } from "pg";
import { execFile } from "node:child_process";
import {
  CTF_ACTIONS,
  emitEvent,
  addDiscovery,
  listTargets,
  getEngagement,
  advancePhase,
  sendMessage,
  type Action,
  type Playbook,
} from "@promptkiddie/core";
import { createRunContext } from "./run-context.js";
import { EventBus } from "./event-bus.js";
import { createWsServer, type WsBroadcaster } from "./ws-server.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://promptkiddie:changeme_local_only@localhost:5432/promptkiddie";

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
  onEvent?: (event: { type: string; payload: Record<string, unknown> }) => void;
  onActionStart?: (actionName: string) => void;
  onActionEnd?: (actionName: string) => void;
  onOutput?: (actionName: string, line: string) => void;
}

const PHASE_IMAGES: Record<string, string> = {
  recon: "pk-agent-recon",
  enum: "pk-agent-recon",
  exploit: "pk-agent-attack",
  postexploit: "pk-agent-full",
  report: "pk-agent-recon",
};

function resolveAgentImage(action: Action, phase: string): string {
  if (action.llm?.agent === "exploit-agent") return "pk-agent-full";
  if (action.llm?.agent === "recon-agent") return "pk-agent-recon";
  return PHASE_IMAGES[phase] ?? "pk-agent-attack";
}

function spawnAgentContainer(engagementId: string, image: string, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["--silent", "pk", "spawn", "agent", "--image", image, "--target", target, "--engagement", engagementId];
    execFile("pnpm", args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      try {
        const result = JSON.parse(stdout) as { container: string };
        resolve(result.container);
      } catch {
        resolve(stdout.trim());
      }
    });
  });
}

export async function startSupervisor(opts: SupervisorOpts) {
  const playbook = opts.playbook ?? CTF_ACTIONS;
  const mode: SupervisorMode = opts.mode ?? "standard";
  const maxConcurrent = opts.maxConcurrent ?? MODE_CONCURRENCY[mode];
  const activeActions = new Map<string, AbortController>();
  const bus = new EventBus();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const STALL_TIMEOUT = 5 * 60 * 1000;
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

  // WebSocket server for frontend event streaming
  const wsPort = parseInt(process.env.PK_WS_PORT ?? "3200", 10);
  const ws: WsBroadcaster = createWsServer(wsPort);

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

  const engagement = await getEngagement(opts.engagementId);
  if (!engagement) throw new Error(`Engagement ${opts.engagementId} not found`);
  currentPhase = engagement.phase ?? "scoping";

  const targets = await listTargets(opts.engagementId);
  const primaryTarget = targets.find((t) => t.inScope)?.identifier ?? targets[0]?.identifier ?? "unknown";

  console.log(`[supervisor] starting for "${engagement.name}" (${opts.engagementId})`);
  console.log(`[supervisor] mode: ${mode} (maxConcurrent: ${maxConcurrent})`);
  console.log(`[supervisor] target: ${primaryTarget}`);
  console.log(`[supervisor] playbook: ${playbook.name} (${playbook.actions.length} actions)`);

  function resetStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      console.log("[supervisor] stall detected, emitting StallDetected");
      emitEvent(opts.engagementId, "StallDetected", { minutes: 5 }, "supervisor").catch(
        (err) => console.error("[supervisor] stall event emit failed:", err),
      );
    }, STALL_TIMEOUT);
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
        const agentImage = resolveAgentImage(action, currentPhase);
        const failKey = `${action.name}:${agentImage}`;
        const priorFails = spawnFailures.get(failKey) ?? 0;

        if (priorFails >= MAX_SPAWN_RETRIES) {
          console.log(`[supervisor] skipping "${action.name}" (spawn failed ${priorFails}x for ${agentImage}, sending to inbox only)`);
          const interpolated = action.prompt.replace(/\{(\w+)\}/g, (_: string, key: string) =>
            String(event.payload[key] ?? `{${key}}`));
          await sendMessage({
            engagementId: opts.engagementId,
            direction: "inbound",
            author: "supervisor",
            body: `[agent-task:${action.name}] (image ${agentImage} unavailable)\n\n${interpolated}`,
          });
          return;
        }

        console.log(`[supervisor] agent action "${action.name}" -> spawning ${agentImage}`);

        if (mode === "learning") {
          await sendMessage({
            engagementId: opts.engagementId,
            direction: "outbound",
            author: "supervisor",
            body: `[learning] Action "${action.name}" wants to spawn ${agentImage}:\n${action.prompt.slice(0, 500)}\n\nReply to approve or redirect.`,
          });
        }

        // Interpolate template variables in the prompt
        const interpolated = action.prompt.replace(/\{(\w+)\}/g, (_: string, key: string) => {
          return String(event.payload[key] ?? `{${key}}`);
        });

        try {
          const containerName = await spawnAgentContainer(opts.engagementId, agentImage, primaryTarget);
          console.log(`[supervisor] spawned: ${containerName}`);

          // Send the prompt to the inbox so the agent picks it up
          await sendMessage({
            engagementId: opts.engagementId,
            direction: "inbound",
            author: "supervisor",
            body: `[agent-task:${action.name}]\n\n${interpolated}`,
          });

          await addDiscovery({
            engagementId: opts.engagementId,
            type: "attempted",
            category: "agent",
            summary: `Agent "${action.name}" spawned as ${containerName} (${agentImage})`,
          });

          ws.sendEvent({ type: "AgentSpawned", payload: { action: action.name, container: containerName, image: agentImage } });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          spawnFailures.set(failKey, priorFails + 1);
          console.error(`[supervisor] spawn failed for "${action.name}" (${priorFails + 1}/${MAX_SPAWN_RETRIES}): ${msg}`);
          // Fall back to inbox-only dispatch (orchestrator picks it up manually)
          await sendMessage({
            engagementId: opts.engagementId,
            direction: "inbound",
            author: "supervisor",
            body: `[agent-task:${action.name}] (spawn failed: ${msg})\n\n${interpolated}`,
          });
          await addDiscovery({
            engagementId: opts.engagementId,
            type: "negative",
            category: "agent",
            summary: `Agent spawn failed for "${action.name}": ${msg}. Task sent to inbox.`,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[supervisor] action "${action.name}" failed: ${msg}`);
      await addDiscovery({
        engagementId: opts.engagementId,
        type: "negative",
        category: "error",
        summary: `Action "${action.name}" failed: ${msg}`,
      });
    } finally {
      const key = [...activeActions.entries()].find(([k]) => k.startsWith(action.name))?.[0];
      if (key) activeActions.delete(key);
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
        const result = await advancePhase(eid, targetPhase as Parameters<typeof advancePhase>[1]);
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
    resetStallTimer();
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

    for (const action of matched) {
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

  // Connect to Postgres and LISTEN for events
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("LISTEN pk_events");
  console.log("[supervisor] listening on pk_events");

  client.on("notification", (msg) => {
    if (msg.channel !== "pk_events" || !msg.payload) return;
    try {
      const parsed = JSON.parse(msg.payload) as { id: string; type: string; engagement_id: string };
      if (parsed.engagement_id !== opts.engagementId) return;

      // Fetch the full event payload from DB
      client.query("SELECT type, payload FROM events WHERE id = $1", [parsed.id])
        .then((result) => {
          if (result.rows.length === 0) return;
          const row = result.rows[0] as { type: string; payload: Record<string, unknown> };
          evaluateAndDispatch({ type: row.type, payload: row.payload, id: parsed.id });
        })
        .catch((err) => console.error("[supervisor] event fetch error:", err));
    } catch {
      // malformed notification
    }
  });

  // Fire EngagementStarted to kick things off
  console.log("[supervisor] emitting EngagementStarted");
  await emitEvent(opts.engagementId, "EngagementStarted", { target: primaryTarget }, "supervisor");

  resetStallTimer();

  // Handle shutdown
  const shutdown = async () => {
    console.log("\n[supervisor] shutting down...");
    if (stallTimer) clearTimeout(stallTimer);
    for (const [, ac] of activeActions) ac.abort();
    await ws.close();
    await client.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep alive
  return {
    stop: shutdown,
    dispatch: evaluateAndDispatch,
    releasePending,
    get pendingCount() { return pendingLlmTasks.length; },
    mode,
    ws,
  };
}

// CLI entry point (only when run directly, not when imported by pk CLI)
const isDirectRun = process.argv[1]?.includes("supervisor");
if (isDirectRun) {
  const engagementId = process.argv[2];
  if (!engagementId) {
    console.error("Usage: pk supervisor start <engagement-id> [--mode race|standard|methodical|learning]");
    process.exit(1);
  }

  const modeArgIdx = process.argv.indexOf("--mode");
  const cliMode = modeArgIdx >= 0 ? (process.argv[modeArgIdx + 1] as SupervisorMode | undefined) : undefined;
  const validModes: SupervisorMode[] = ["race", "standard", "methodical", "learning"];
  if (cliMode && !validModes.includes(cliMode)) {
    console.error(`Invalid mode "${cliMode}". Valid modes: ${validModes.join(", ")}`);
    process.exit(1);
  }

  startSupervisor({ engagementId, mode: cliMode }).catch((err) => {
    console.error("[supervisor] fatal:", err);
    process.exit(1);
  });
}
