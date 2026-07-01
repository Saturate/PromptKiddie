/**
 * Docker Events-based exec watcher.
 *
 * Streams `exec_create` and `exec_die` events from the Docker Engine HTTP API,
 * correlates them by execID, and writes completed executions to the engagement
 * DB activity trail. Works with local sockets and remote Docker hosts.
 */
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { logActivity } from "./repo.js";

interface PendingExec {
  cmd: string;
  container: string;
  service: string;
  startNano: bigint;
  createdAt: Date;
}

interface DockerEvent {
  Type: string;
  Action: string;
  Actor: {
    ID: string;
    Attributes: Record<string, string>;
  };
  time: number;
  timeNano: number;
}

export interface ExecWatcherOptions {
  engagementId: string;
  phase?: string;
  onExec?: (entry: ExecLogEntry) => void;
  signal?: AbortSignal;
}

export interface ExecLogEntry {
  cmd: string;
  tool: string;
  container: string;
  service: string;
  exitCode: number;
  durationMs: number;
  timestamp: Date;
}

const IGNORE_COMMANDS = [
  "pg_isready",
  "sleep infinity",
];

const SERVICE_TO_PHASE: Record<string, string> = {
  attackbox: "exploit",
  "pk-recon": "recon",
  "pk-attack": "exploit",
  "pk-enum": "enum",
};

function parseDockerHost(): { socketPath?: string; hostname?: string; port?: number; protocol: "http" | "https" } {
  const dockerHost = process.env.DOCKER_HOST;

  if (!dockerHost) {
    const candidates = [
      process.env.HOME + "/.rd/docker.sock",
      "/var/run/docker.sock",
      process.env.HOME + "/.docker/run/docker.sock",
    ];
    for (const s of candidates) {
      if (existsSync(s)) return { socketPath: s, protocol: "http" };
    }
    return { socketPath: "/var/run/docker.sock", protocol: "http" };
  }

  if (dockerHost.startsWith("unix://")) {
    return { socketPath: dockerHost.slice(7), protocol: "http" };
  }

  if (dockerHost.startsWith("tcp://")) {
    const url = new URL(dockerHost.replace("tcp://", "http://"));
    const useTls = url.port === "2376";
    return {
      hostname: url.hostname,
      port: parseInt(url.port || (useTls ? "2376" : "2375"), 10),
      protocol: useTls ? "https" : "http",
    };
  }

  return { socketPath: dockerHost, protocol: "http" };
}

function extractCommand(action: string): string {
  const idx = action.indexOf(": ");
  return idx >= 0 ? action.slice(idx + 2) : action;
}

function extractTool(cmd: string): string {
  const cleaned = cmd.replace(/^sh -c\s+/, "").replace(/^\/bin\/sh -c\s+/, "");
  const first = cleaned.split(/\s+/)[0];
  return first.split("/").pop() ?? first;
}

export function startExecWatcher(opts: ExecWatcherOptions): { stop: () => void } {
  const { engagementId, onExec, signal } = opts;
  const pending = new Map<string, PendingExec>();
  const docker = parseDockerHost();

  const filters = JSON.stringify({
    type: ["container"],
    event: ["exec_create", "exec_die"],
    label: ["com.docker.compose.project=promptkiddie"],
  });

  const path = `/v1.45/events?filters=${encodeURIComponent(filters)}`;

  const reqFn = docker.protocol === "https" ? httpsRequest : httpRequest;
  const reqOpts: Record<string, unknown> = {
    path,
    method: "GET",
    headers: { Accept: "application/json" },
  };

  if (docker.socketPath) {
    reqOpts.socketPath = docker.socketPath;
  } else {
    reqOpts.hostname = docker.hostname;
    reqOpts.port = docker.port;
  }

  let destroyed = false;

  const req = reqFn(reqOpts, (res) => {
    let buffer = "";

    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          processEvent(JSON.parse(line) as DockerEvent);
        } catch {
          // malformed JSON line, skip
        }
      }
    });

    res.on("end", () => {
      if (!destroyed) {
        // Reconnect after 1s if connection drops
        setTimeout(() => {
          if (!destroyed) startExecWatcher(opts);
        }, 1000);
      }
    });
  });

  req.on("error", (err) => {
    if (!destroyed) {
      console.error(`[exec-watcher] connection error: ${err.message}, retrying in 5s`);
      setTimeout(() => {
        if (!destroyed) startExecWatcher(opts);
      }, 5000);
    }
  });

  req.end();

  if (signal) {
    signal.addEventListener("abort", () => {
      destroyed = true;
      req.destroy();
    });
  }

  function processEvent(ev: DockerEvent) {
    const attrs = ev.Actor?.Attributes ?? {};
    const project = attrs["com.docker.compose.project"];
    if (project !== "promptkiddie") return;

    const execID = attrs.execID;
    if (!execID) return;

    const service = attrs["com.docker.compose.service"] ?? "";
    const container = attrs.name ?? "";

    if (ev.Action.startsWith("exec_create")) {
      const cmd = extractCommand(ev.Action);

      if (IGNORE_COMMANDS.some((ic) => cmd.includes(ic))) return;

      pending.set(execID, {
        cmd,
        container,
        service,
        startNano: BigInt(ev.timeNano),
        createdAt: new Date(ev.time * 1000),
      });
    }

    if (ev.Action === "exec_die") {
      const p = pending.get(execID);
      if (!p) return;
      pending.delete(execID);

      const exitCode = parseInt(attrs.exitCode ?? "0", 10);
      const endNano = BigInt(ev.timeNano);
      const durationMs = Number((endNano - p.startNano) / 1_000_000n);
      const tool = extractTool(p.cmd);

      const entry: ExecLogEntry = {
        cmd: p.cmd,
        tool,
        container: p.container,
        service: p.service,
        exitCode,
        durationMs,
        timestamp: p.createdAt,
      };

      if (onExec) onExec(entry);

      type Phase = "scoping" | "recon" | "enum" | "exploit" | "postexploit" | "report";
      const phase = (opts.phase ?? SERVICE_TO_PHASE[p.service] ?? "recon") as Phase;

      logActivity({
        engagementId,
        phase,
        action: `[container] ${tool} (${durationMs}ms, exit ${exitCode})`,
        command: p.cmd,
        actor: "agent",
      }).catch(() => {
        // DB write failed, non-fatal
      });
    }

    // Evict stale pending entries (older than 10 minutes)
    const now = Date.now();
    for (const [id, p] of pending) {
      if (now - p.createdAt.getTime() > 600_000) pending.delete(id);
    }
  }

  return {
    stop() {
      destroyed = true;
      req.destroy();
    },
  };
}
