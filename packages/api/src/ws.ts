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

export function setupWebSocket(server: Server, databaseUrl: string) {
  const wss = new WebSocketServer({ server, path: "/ws/events" });

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
  const listener = new pg.Client(databaseUrl);
  listener.connect().then(async () => {
    await listener.query("LISTEN pk_events");
    console.log("[ws] listening on pk_events channel");
  });

  listener.on("notification", (msg) => {
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
  });

  // PTY output relay: agents POST output, we broadcast to subscribed frontends
  const ptyClients = new Map<string, Set<WebSocket>>();

  const ptyWss = new WebSocketServer({ server, path: "/ws/pty" });

  ptyWss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const agentId = url.searchParams.get("agentId");
    if (!agentId) { ws.close(4000, "agentId required"); return; }

    if (!hasKeys()) {
      if (!ptyClients.has(agentId)) ptyClients.set(agentId, new Set());
      ptyClients.get(agentId)!.add(ws);
      ws.on("close", () => { ptyClients.get(agentId)?.delete(ws); if (ptyClients.get(agentId)?.size === 0) ptyClients.delete(agentId); });
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
    broadcastPty(agentId: string, data: string) {
      const subs = ptyClients.get(agentId);
      if (!subs) return;
      for (const ws of subs) {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    },
  };
}
