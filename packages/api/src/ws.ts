import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import pg from "pg";
import { resolveKey, hasKeys } from "./middleware/auth.js";

interface WsClient {
  ws: WebSocket;
  engagementId?: string;
  identity: string;
}

const clients = new Set<WsClient>();

export function getWsClientCount(): number { return clients.size; }

export function setupWebSocket(server: Server, databaseUrl: string) {
  const wss = new WebSocketServer({ server, path: "/ws/events", perMessageDeflate: false });

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
  const ptyAliases = new Map<string, string>(); // container name -> agent ID

  const ptyWss = new WebSocketServer({ server, path: "/ws/pty" });

  ptyWss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rawId = url.searchParams.get("agentId");
    if (!rawId) { ws.close(4000, "agentId required"); return; }
    // Resolve alias: if this is a container name, also subscribe under the real agent ID
    const agentId = rawId;
    const resolvedId = ptyAliases.get(rawId) ?? rawId;
    const subscribeIds = new Set([agentId, resolvedId]);

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

  return {
    registerPtyAlias(containerName: string, agentId: string) {
      ptyAliases.set(containerName, agentId);
      ptyAliases.set(agentId, containerName);
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
