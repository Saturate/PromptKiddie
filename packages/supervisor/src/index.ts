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
import {
  CTF_ACTIONS,
  emitEvent,
  addDiscovery,
  listTargets,
  getEngagement,
  buildLlmContext,
  type Action,
  type Playbook,
} from "@promptkiddie/core";
import { createRunContext } from "./run-context.js";
import { EventBus } from "./event-bus.js";
import { createWsServer, type WsBroadcaster } from "./ws-server.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://promptkiddie:changeme_local_only@localhost:5432/promptkiddie";

interface SupervisorOpts {
  engagementId: string;
  playbook?: Playbook;
  maxConcurrent?: number;
  onEvent?: (event: { type: string; payload: Record<string, unknown> }) => void;
  onActionStart?: (actionName: string) => void;
  onActionEnd?: (actionName: string) => void;
  onOutput?: (actionName: string, line: string) => void;
}

export async function startSupervisor(opts: SupervisorOpts) {
  const playbook = opts.playbook ?? CTF_ACTIONS;
  const maxConcurrent = opts.maxConcurrent ?? 3;
  const activeActions = new Map<string, AbortController>();
  const bus = new EventBus();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const STALL_TIMEOUT = 5 * 60 * 1000;

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

  const targets = await listTargets(opts.engagementId);
  const primaryTarget = targets.find((t) => t.inScope)?.identifier ?? targets[0]?.identifier ?? "unknown";

  console.log(`[supervisor] starting for "${engagement.name}" (${opts.engagementId})`);
  console.log(`[supervisor] target: ${primaryTarget}`);
  console.log(`[supervisor] playbook: ${playbook.name} (${playbook.actions.length} actions)`);

  function resetStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(async () => {
      console.log("[supervisor] stall detected, emitting StallDetected");
      await emitEvent(opts.engagementId, "StallDetected", { minutes: 5 }, "supervisor");
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
            phase: engagement.phase,
            mode: "standard",
          },
          onOutput: (line) => opts.onOutput?.(action.name, line),
          signal: ac.signal,
        });

        await action.run(ctx);
      }

      if (action.prompt && !action.run) {
        console.log(`[supervisor] agent action "${action.name}" - prompt: ${action.prompt.slice(0, 100)}...`);
        console.log(`[supervisor] (agent dispatch not yet implemented, logging prompt)`);
        await addDiscovery({
          engagementId: opts.engagementId,
          type: "attempted",
          category: "agent",
          summary: `Agent action "${action.name}" queued (prompt-based dispatch pending)`,
        });
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

  function evaluateAndDispatch(event: { type: string; payload: Record<string, unknown>; id?: string }) {
    resetStallTimer();
    opts.onEvent?.(event);

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
          dispatchAction(action, event);
        }
      } catch {
        // trigger threw; skip
      }
    }
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
    ws,
  };
}

// CLI entry point
const engagementId = process.argv[2];
if (!engagementId) {
  console.error("Usage: pk supervisor start <engagement-id>");
  process.exit(1);
}

startSupervisor({ engagementId }).catch((err) => {
  console.error("[supervisor] fatal:", err);
  process.exit(1);
});
