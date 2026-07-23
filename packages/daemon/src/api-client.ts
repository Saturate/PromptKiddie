/**
 * Lightweight API broadcaster that replaces the old ws-server.ts.
 * Instead of running a WS server, the supervisor POSTs output to the API,
 * which broadcasts to frontends via its own WebSocket.
 */
import WebSocket from "ws";

const API_URL = process.env.PK_API_URL ?? "http://localhost:3200";
const API_BASE = API_URL.endsWith("/api") ? API_URL : `${API_URL}/api`;
const API_KEY = process.env.PK_API_KEY ?? "";

const headers: Record<string, string> = { "Content-Type": "application/json" };
if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

async function postToApi(path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api-client] POST ${path} failed: ${msg}`);
  }
}

export interface ApiBroadcaster {
  sendEvent(event: {
    id?: string;
    type: string;
    payload: Record<string, unknown>;
    source?: string;
    createdAt?: Date;
  }): void;
  sendActionStart(name: string): void;
  sendActionEnd(name: string): void;
  sendOutput(action: string, line: string): void;
  close(): Promise<void>;
}

export function createApiBroadcaster(engagementId: string): ApiBroadcaster {
  return {
    sendEvent(_event) {
      // Events flow through repo.emitEvent() -> Postgres -> API LISTEN/NOTIFY -> WebSocket
      // No need to POST separately; the API broadcasts automatically
    },
    sendActionStart(name) {
      postToApi(`/agents/${engagementId}/output`, {
        data: JSON.stringify({ type: "action_start", data: { name } }),
      });
    },
    sendActionEnd(name) {
      postToApi(`/agents/${engagementId}/output`, {
        data: JSON.stringify({ type: "action_end", data: { name } }),
      });
    },
    sendOutput(action, line) {
      postToApi(`/agents/${engagementId}/output`, {
        data: JSON.stringify({ type: "output", data: { action, line } }),
      });
    },
    async close() {},
  };
}

export function connectEventStream(
  engagementId: string,
  onEvent: (event: { id?: string; type: string; payload: Record<string, unknown> }) => void,
): { close: () => void } {
  const dbUrl = process.env.DATABASE_URL;

  // In-process mode: listen to Postgres directly (avoids WS self-connection issues)
  if (dbUrl) {
    return connectViaPg(dbUrl, engagementId, onEvent);
  }

  // Remote mode: connect via WebSocket to the API
  return connectViaWs(engagementId, onEvent);
}

function connectViaPg(
  dbUrl: string,
  engagementId: string,
  onEvent: (event: { id?: string; type: string; payload: Record<string, unknown> }) => void,
): { close: () => void } {
  const state = { closed: false, client: null as { end: () => Promise<void> } | null };

  function startListening() {
    if (state.closed) return;
    (async () => {
      const pg = await import("pg");
      const client = new pg.default.Client(dbUrl);
      state.client = client;
      await client.connect();
      await client.query("LISTEN pk_events");
      console.log("[event-stream] listening via Postgres NOTIFY");

      client.on("notification", (msg) => {
        if (msg.channel !== "pk_events" || !msg.payload) return;
        try {
          const event = JSON.parse(msg.payload) as { engagementId?: string; type: string; payload: Record<string, unknown> };
          if (engagementId && event.engagementId !== engagementId) return;
          onEvent(event);
        } catch {}
      });

      client.on("error", (err) => {
        if (state.closed) return;
        console.error("[event-stream] pg error:", err.message);
      });

      client.on("end", () => {
        if (state.closed) return;
        console.log("[event-stream] pg disconnected, reconnecting...");
        setTimeout(() => startListening(), 2000);
      });
    })().catch((err) => {
      if (state.closed) return;
      console.error("[event-stream] pg connect failed:", (err as Error).message);
      setTimeout(() => startListening(), 5000);
    });
  }

  startListening();

  return {
    close() {
      state.closed = true;
      state.client?.end().catch(() => {});
    },
  };
}

function connectViaWs(
  engagementId: string,
  onEvent: (event: { id?: string; type: string; payload: Record<string, unknown> }) => void,
): { close: () => void } {
  const wsUrl = API_URL.replace(/^http/, "ws") + `/ws/events?engagementId=${engagementId}`;
  let ws: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(wsUrl, [], { perMessageDeflate: false });

    ws.on("open", () => {
      console.log("[event-stream] connected to API WebSocket");
      if (API_KEY) ws!.send(JSON.stringify({ key: API_KEY }));
    });

    ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        onEvent(event);
      } catch {}
    });

    ws.on("close", () => {
      if (closed) return;
      console.log("[event-stream] disconnected, reconnecting in 2s...");
      setTimeout(connect, 2000);
    });

    ws.on("error", (err) => {
      console.error("[event-stream] error:", err.message);
      ws?.close();
    });
  }

  connect();

  return {
    close() {
      closed = true;
      ws?.close();
    },
  };
}
