/**
 * WebSocket server for broadcasting supervisor events to the frontend.
 *
 * Runs alongside the supervisor process on a configurable port (default 3200).
 * Clients connect via `ws://localhost:3200` and receive JSON messages:
 *
 *   { type: "event",        data: { id, type, payload, source, createdAt } }
 *   { type: "action_start", data: { name } }
 *   { type: "action_end",   data: { name } }
 *   { type: "output",       data: { action, line } }
 */
import { WebSocketServer, WebSocket } from "ws";

export interface WsBroadcaster {
  /** Broadcast a supervisor event to all connected clients. */
  sendEvent(event: {
    id?: string;
    type: string;
    payload: Record<string, unknown>;
    source?: string;
    createdAt?: Date;
  }): void;

  /** Broadcast action start. */
  sendActionStart(name: string): void;

  /** Broadcast action end. */
  sendActionEnd(name: string): void;

  /** Broadcast a line of output from a running action. */
  sendOutput(action: string, line: string): void;

  /** Shut down the server. */
  close(): Promise<void>;
}

export function createWsServer(port = 3200): WsBroadcaster {
  const wss = new WebSocketServer({ port });

  console.log(`[ws] listening on ws://localhost:${port}`);

  wss.on("connection", (ws) => {
    console.log(`[ws] client connected (${wss.clients.size} total)`);
    ws.on("close", () => {
      console.log(`[ws] client disconnected (${wss.clients.size} total)`);
    });
  });

  function broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  return {
    sendEvent(event) {
      broadcast({
        type: "event",
        data: {
          id: event.id ?? `evt-${Date.now()}`,
          type: event.type,
          payload: event.payload,
          source: event.source ?? "supervisor",
          createdAt: (event.createdAt ?? new Date()).toISOString(),
        },
      });
    },

    sendActionStart(name: string) {
      broadcast({ type: "action_start", data: { name } });
    },

    sendActionEnd(name: string) {
      broadcast({ type: "action_end", data: { name } });
    },

    sendOutput(action: string, line: string) {
      broadcast({ type: "output", data: { action, line } });
    },

    async close() {
      return new Promise<void>((resolve) => {
        wss.close(() => {
          console.log("[ws] server closed");
          resolve();
        });
      });
    },
  };
}
