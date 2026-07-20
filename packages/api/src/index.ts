import "dotenv/config";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadConfig } from "@promptkiddie/core";
import { createApp } from "./app.js";
import { initKeys, authMiddleware } from "./middleware/auth.js";
import { setupWebSocket } from "./ws.js";
import { setSupervisorState } from "./supervisor-state.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set PK_API_URL before loadConfig() caches it, so the in-process supervisor can reach the API
const apiPort = process.env.PK_API_PORT ? Number(process.env.PK_API_PORT) : 3200;
if (!process.env.PK_API_URL) process.env.PK_API_URL = `http://localhost:${apiPort}`;

const config = loadConfig();
const port = config.api.port;
const databaseUrl = process.env.DATABASE_URL ?? "";

initKeys(process.env.PK_API_KEYS);

const root = new Hono();

const api = createApp();
api.use("/*", authMiddleware(config.api.secret ?? undefined));

api.get("/agents/:name/logs", async (c) => {
  const name = c.req.param("name");
  if (!name.startsWith("pk-agent-") && !name.startsWith("pk-worker-")) return c.json({ error: "invalid container" }, 400);
  try {
    const { execFile: ef } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(ef);
    const { stdout } = await execAsync("docker", ["logs", "--tail", "200", name], { timeout: 5000 });
    return c.text(stdout);
  } catch {
    return c.text("No logs available", 404);
  }
});

api.delete("/agents/:name/container", async (c) => {
  const name = c.req.param("name");
  if (!name.startsWith("pk-agent-") && !name.startsWith("pk-worker-")) {
    return c.json({ error: "invalid container name" }, 400);
  }
  try {
    const { execFile: ef } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(ef);
    await execAsync("docker", ["rm", "-f", name], { timeout: 10000 });
    return c.json({ ok: true, removed: name });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

api.post("/agents/:id/alias", async (c) => {
  const body = await c.req.json();
  const { container, action, image, engagementId } = body;
  if (container) {
    const meta = action ? { action, image: image ?? "", engagementId: engagementId ?? "" } : undefined;
    wsBroadcast?.registerPtyAlias(container, c.req.param("id"), meta);
  }
  return c.json({ ok: true });
});

api.post("/agents/:id/output", async (c) => {
  const body = await c.req.json();
  const agentId = c.req.param("id");
  const containerName = body.container ?? "";
  wsBroadcast?.broadcastPty(agentId, body.data ?? "");
  if (containerName) wsBroadcast?.broadcastPty(containerName, body.data ?? "");
  return c.json({ ok: true });
});

// All API routes under /api/ prefix
root.route("/api", api);

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

  // Start supervisor standby: auto-manages per-engagement supervisors on status change
  import("@promptkiddie/supervisor").then(({ startStandby }) => {
    startStandby({})
      .then((standby) => {
        console.log(`[supervisor] standby started (${standby.activeCount} active engagement(s))`);
        const update = () => setSupervisorState({
          running: true,
          activeCount: standby.activeCount,
          activeEngagements: standby.activeEngagements,
        });
        update();
        setInterval(update, 5000);
      })
      .catch((err) => {
        console.error("[supervisor] standby failed:", (err as Error).message ?? err);
      });
  }).catch((err) => {
    console.error("[supervisor] import failed:", (err as Error).message ?? err);
  });
}
