import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { execFile } from "node:child_process";
import pg from "pg";
import { resolveKey, hasKeys } from "./middleware/auth.js";

/**
 * Bridge Cartridge's native WS into the PK WS.
 * Connects to ws://<container-ip>:4500/api/agents/{id}/ws inside
 * the Docker network and forwards terminal output to the SPA client.
 */
function bridgeCartridgeWs(containerName: string, clientWs: WebSocket) {
  let stopped = false;
  let cartridgeWs: WebSocket | null = null;

  clientWs.on("close", () => {
    stopped = true;
    cartridgeWs?.close();
  });

  // Forward input from SPA to Cartridge (bidirectional)
  clientWs.on("message", (data) => {
    if (cartridgeWs?.readyState === WebSocket.OPEN) {
      cartridgeWs.send(data);
    }
  });

  function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout ?? "");
      });
    });
  }

  (async () => {
    // Wait for Cartridge to start and find the agent ID
    for (let attempt = 0; attempt < 30 && !stopped; attempt++) {
      try {
        const agentsJson = await execAsync("docker", [
          "exec", containerName, "curl", "-sf", "http://localhost:4500/api/agents",
        ]);
        const agents = JSON.parse(agentsJson) as { agents: Array<{ id: string }> };
        const agent = agents.agents[0];
        if (agent) {
          // Get the container's IP on the Docker network
          let cartridgeHost = "localhost";
          try {
            const ipResult = await execAsync("docker", [
              "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", containerName,
            ]);
            const ip = ipResult.trim();
            if (ip) cartridgeHost = ip;
          } catch {}

          // Try native WS to Cartridge (works on Linux, fails on macOS Docker Desktop)
          const wsUrl = `ws://${cartridgeHost}:4500/api/agents/${agent.id}/ws`;
          try {
            cartridgeWs = new WebSocket(wsUrl);
            let connected = false;

            cartridgeWs.on("open", () => { connected = true; });

            cartridgeWs.on("message", (data) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data);
              }
            });

            cartridgeWs.on("close", () => {
              if (clientWs.readyState === WebSocket.OPEN && connected) {
                clientWs.close();
              }
            });

            let fallbackStarted = false;
            function startFallback() {
              if (fallbackStarted) return;
              fallbackStarted = true;
              pollFallback(containerName, agent.id, clientWs);
            }

            cartridgeWs.on("error", () => {
              cartridgeWs = null;
              if (!connected) startFallback();
            });

            // Timeout: if no connection in 3s, assume native WS is broken
            setTimeout(() => {
              if (!connected && cartridgeWs) {
                cartridgeWs.close();
                cartridgeWs = null;
                startFallback();
              }
            }, 3000);
          } catch {
            pollFallback(containerName, agent.id, clientWs);
          }

          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
  })();
}

function pollFallback(containerName: string, agentId: string, ws: WebSocket) {
  let offset = 0;
  let stopped = false;
  ws.on("close", () => { stopped = true; });

  function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout ?? "");
      });
    });
  }

  (async () => {
    while (!stopped && ws.readyState === WebSocket.OPEN) {
      try {
        const json = await execAsync("docker", [
          "exec", containerName, "curl", "-sf",
          `http://localhost:4500/api/agents/${agentId}/output?offset=${offset}`,
        ]);
        const output = JSON.parse(json) as { data: string; next_offset: number };
        if (output.data?.length > 0) {
          ws.send(output.data);
          offset = output.next_offset;
        }
      } catch {}
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

    // If this is a Cartridge container, bridge its native WS
    const isContainer = rawId.startsWith("pk-orch-") || rawId.startsWith("pk-agent-");
    if (isContainer) {
      bridgeCartridgeWs(rawId, ws);
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
