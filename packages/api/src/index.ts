import "dotenv/config";
import { serve } from "@hono/node-server";
import { loadConfig } from "@promptkiddie/core";
import { createApp } from "./app.js";
import { initKeys, authMiddleware } from "./middleware/auth.js";
import { setupWebSocket } from "./ws.js";

const config = loadConfig();
const port = config.api.port;
const databaseUrl = process.env.DATABASE_URL ?? "";

initKeys(process.env.PK_API_KEYS);

const app = createApp();

app.use("/*", authMiddleware(config.api.secret ?? undefined));

let wsBroadcast: ReturnType<typeof setupWebSocket> | null = null;

app.post("/agents/:id/output", async (c) => {
  const body = await c.req.json();
  wsBroadcast?.broadcastPty(c.req.param("id"), body.data ?? "");
  return c.json({ ok: true });
});

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`pk-api listening on http://localhost:${port}`);
});

if (databaseUrl) {
  wsBroadcast = setupWebSocket(server as unknown as import("node:http").Server, databaseUrl);
}
