import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { execFile } from "node:child_process";
import pg from "pg";
import { resolveKey, hasKeys } from "./middleware/auth.js";

/**
 * Bridge Cartridge terminal output into a WebSocket.
 * Runs server-side: reads from `docker exec <container> curl .../output?offset=N`
 * and pushes chunks to the connected WS client.
 */
function bridgeCartridgeOutput(containerName: string, ws: WebSocket) {
  let offset = 0;
  let stopped = false;
  let agentId: string | null = null;

  ws.on("close", () => { stopped = true; });

  async function fetchOnce(): Promise<boolean> {
    if (stopped || ws.readyState !== WebSocket.OPEN) return false;
    try {
      if (!agentId) {
        const agentsJson = await execAsync("docker", [
          "exec", containerName, "curl", "-sf", "http://localhost:4500/api/agents",
        ]);
        const agents = JSON.parse(agentsJson) as { agents: Array<{ id: string; status: string }> };
        const agent = agents.agents[0];
        if (!agent) return true; // no agent yet, retry
        agentId = agent.id;
      }

      const outputJson = await execAsync("docker", [
        "exec", containerName, "curl", "-sf",
        `http://localhost:4500/api/agents/${agentId}/output?offset=${offset}`,
      ]);
      const output = JSON.parse(outputJson) as { data: string; next_offset: number; total_bytes: number };
      if (output.data && output.data.length > 0) {
        ws.send(output.data);
        offset = output.next_offset;
      }
      return true;
    } catch {
      return true; // container might still be starting
    }
  }

  function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout ?? "");
      });
    });
  }

  // Stream loop: fetch every 500ms
  (async () => {
    // Wait briefly for Cartridge to start
    await new Promise(r => setTimeout(r, 2000));
    while (!stopped && ws.readyState === WebSocket.OPEN) {
      const ok = await fetchOnce();
      if (!ok) break;
      await new Promise(r => setTimeout(r, 500));
    }
  })();
}

interface WsClient {
  ws: WebSocket;
  engagementId?: string;
  identity: string;
}

const clients = new Set<WsClient>();

export function getWsClientCount(): number { return clients.size; }

let _containerMeta: Map<string, { action: string; image: string; engagementId: string }> | null = null;
export function getContainerMeta(name: string) { return _containerMeta?.get(name) ?? null; }
export function getAllContainerMeta() { return _containerMeta ? Object.fromEntries(_containerMeta) : {}; }

export function setupWebSocket(server: Server, databaseUrl: string) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const engagementId = url.searchParams.get("engagementId") ?? undefined;

    if (!hasKeys()) {
      const client: WsClient = { ws, engagementId, identity: "anonymous" };
      clients.add(client);
      ws.on("close", () => clients.delete(client));
      ws.on("error", () => clients.delete(client));
      return;
    }

    // Auth via first message: client sends { key: "..." }
    const authTimeout = setTimeout(() => ws.close(4001, "auth timeout"), 5000);

    ws.once("message", (data) => {
      clearTimeout(authTimeout);
      let key = "";
      try {
        const msg = JSON.parse(data.toString());
        key = msg.key ?? "";
      } catch { /* invalid JSON */ }

      const resolved = resolveKey(key);
      if (!resolved) {
        ws.close(4001, "unauthorized");
        return;
      }

      const client: WsClient = { ws, engagementId, identity: resolved.raw };
      clients.add(client);
      ws.on("close", () => clients.delete(client));
      ws.on("error", () => clients.delete(client));
      ws.send(JSON.stringify({ type: "authenticated", identity: resolved.raw }));
    });
  });

  // Single pg LISTEN connection for event broadcasting
  let listener: pg.Client;

  function connectListener() {
    listener = new pg.Client(databaseUrl);
    listener.connect().then(async () => {
      await listener.query("LISTEN pk_events");
      console.log("[ws] listening on pk_events channel");
    }).catch((err) => {
      console.error("[ws] pg listener connect failed:", err.message);
      setTimeout(connectListener, 5000);
    });

    listener.on("error", (err) => {
      console.error("[ws] pg listener error:", err.message);
    });

    listener.on("end", () => {
      console.log("[ws] pg listener disconnected, reconnecting...");
      setTimeout(connectListener, 2000);
    });

    listener.on("notification", onNotification);
  }

  function onNotification(msg: pg.Notification) {
    if (msg.channel !== "pk_events" || !msg.payload) return;

    let event: { engagementId?: string; type?: string; payload?: unknown };
    try {
      event = JSON.parse(msg.payload);
    } catch {
      return;
    }

    const data = JSON.stringify(event);

    for (const client of clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.engagementId && client.engagementId !== event.engagementId) continue;
      client.ws.send(data);
    }
  }

  connectListener();

  // PTY output relay: agents POST output, we broadcast to subscribed frontends
  const ptyClients = new Map<string, Set<WebSocket>>();
  const ptyAliases = new Map<string, string>(); // container name <-> agent ID
  const ptyMeta = new Map<string, { action: string; image: string; engagementId: string }>(); // container name -> metadata
  _containerMeta = ptyMeta;

  const ptyWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  ptyWss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rawId = url.searchParams.get("agentId");
    if (!rawId) { ws.close(4000, "agentId required"); return; }
    // Resolve alias: if this is a container name, also subscribe under the real agent ID
    const agentId = rawId;
    const resolvedId = ptyAliases.get(rawId) ?? rawId;
    const subscribeIds = new Set([agentId, resolvedId]);

    // If this is a container name, bridge Cartridge output into the WS
    const isContainer = rawId.startsWith("pk-orch-") || rawId.startsWith("pk-agent-");
    if (isContainer) {
      bridgeCartridgeOutput(rawId, ws);
    }

    if (!hasKeys()) {
      for (const id of subscribeIds) {
        if (!ptyClients.has(id)) ptyClients.set(id, new Set());
        ptyClients.get(id)!.add(ws);
      }
      ws.on("close", () => { for (const id of subscribeIds) { ptyClients.get(id)?.delete(ws); if (ptyClients.get(id)?.size === 0) ptyClients.delete(id); } });
      return;
    }

    const authTimeout = setTimeout(() => ws.close(4001, "auth timeout"), 5000);
    ws.once("message", (data) => {
      clearTimeout(authTimeout);
      let key = "";
      try { const msg = JSON.parse(data.toString()); key = msg.key ?? ""; } catch {}
      if (!resolveKey(key)) { ws.close(4001, "unauthorized"); return; }

      if (!ptyClients.has(agentId)) ptyClients.set(agentId, new Set());
      ptyClients.get(agentId)!.add(ws);
      ws.on("close", () => { ptyClients.get(agentId)?.delete(ws); if (ptyClients.get(agentId)?.size === 0) ptyClients.delete(agentId); });
      ws.send(JSON.stringify({ type: "authenticated" }));
    });
  });

  // Manual upgrade handler: route WS connections to the right server by path
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws/events") {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    } else if (pathname === "/ws/pty") {
      ptyWss.handleUpgrade(request, socket, head, (ws) => ptyWss.emit("connection", ws, request));
    } else {
      socket.destroy();
    }
  });

  return {
    registerPtyAlias(containerName: string, agentId: string, meta?: { action: string; image: string; engagementId: string }) {
      ptyAliases.set(containerName, agentId);
      ptyAliases.set(agentId, containerName);
      if (meta) ptyMeta.set(containerName, meta);
    },
    getContainerMeta(containerName: string) {
      return ptyMeta.get(containerName) ?? null;
    },
    getAllContainerMeta() {
      return Object.fromEntries(ptyMeta);
    },
    broadcastPty(agentId: string, data: string) {
      const subs = ptyClients.get(agentId);
      if (!subs) return;
      for (const ws of subs) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    },
  };
}
