import "dotenv/config";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "@promptkiddie/core";
import { createApp } from "./app.js";
import { initKeys, authMiddleware } from "./middleware/auth.js";
import { setupWebSocket } from "./ws.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const port = config.api.port;
const databaseUrl = process.env.DATABASE_URL ?? "";

initKeys(process.env.PK_API_KEYS);

const root = new Hono();

const api = createApp();
api.use("/*", authMiddleware(config.api.secret ?? undefined));

api.post("/agents/:id/output", async (c) => {
  const body = await c.req.json();
  wsBroadcast?.broadcastPty(c.req.param("id"), body.data ?? "");
  return c.json({ ok: true });
});

// API routes under /api/ prefix
root.route("/api", api);

// Also mount without prefix for backwards compat with createHttpRepo()
root.route("/", api);

let wsBroadcast: ReturnType<typeof setupWebSocket> | null = null;

// Serve SPA static files (no auth required)
const spaDir = resolve(__dirname, "../../spa/dist");
if (existsSync(spaDir)) {
  root.use("/assets/*", serveStatic({ root: spaDir }));
  root.get("*", (c) => {
    const path = c.req.path;
    // Skip API-looking paths
    if (path.startsWith("/api/")) return c.notFound();
    return c.html(readFileSync(`${spaDir}/index.html`, "utf-8"));
  });
}

const server = serve({ fetch: root.fetch, port }, () => {
  console.log(`pk-api listening on http://localhost:${port}`);
  if (existsSync(spaDir)) console.log(`pk-api serving SPA from ${spaDir}`);
});

if (databaseUrl) {
  wsBroadcast = setupWebSocket(server as unknown as import("node:http").Server, databaseUrl);
}
