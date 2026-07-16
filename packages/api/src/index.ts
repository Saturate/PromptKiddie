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

const __dirname = dirname(fileURLToPath(import.meta.url));
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

// Serve SPA static files if the build exists
const spaDir = resolve(__dirname, "../../spa/dist");
if (existsSync(spaDir)) {
  app.use("/*", serveStatic({ root: spaDir }));
  // SPA fallback: serve index.html for non-API routes
  app.get("*", (c) => {
    const path = c.req.path;
    if (path.startsWith("/engagements") || path.startsWith("/ws") || path.startsWith("/agents") ||
        path.startsWith("/targets") || path.startsWith("/findings") || path.startsWith("/services") ||
        path.startsWith("/ports") || path.startsWith("/messages") || path.startsWith("/playbooks") ||
        path.startsWith("/knowledge") || path.startsWith("/settings") || path.startsWith("/objectives") ||
        path.startsWith("/agent-runs")) {
      return c.notFound();
    }
    return c.html(readFileSync(`${spaDir}/index.html`, "utf-8"));
  });
}

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`pk-api listening on http://localhost:${port}`);
  if (existsSync(spaDir)) console.log(`pk-api serving SPA from ${spaDir}`);
});

if (databaseUrl) {
  wsBroadcast = setupWebSocket(server as unknown as import("node:http").Server, databaseUrl);
}
