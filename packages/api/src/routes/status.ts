import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@promptkiddie/core";
import { getWsClientCount } from "../ws.js";

const execFileAsync = promisify(execFile);
const startTime = Date.now();

const app = new Hono();

app.get("/status", async (c) => {
  let database: { ok: boolean; error?: string };
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    database = { ok: true };
  } catch (err) {
    database = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let docker: { ok: boolean; error?: string } = { ok: false };
  let containers: Array<{ name: string; image: string; status: string; created: string; engagementId?: string }> = [];
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps", "-a",
      "--filter", "name=pk-agent-",
      "--format", '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.CreatedAt}}',
    ], { timeout: 5000 });
    docker = { ok: true };
    containers = stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [name, image, status, created] = line.split("\t");
      return { name, image, status, created };
    });
  } catch (err) {
    docker = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let agents = { running: 0, total: 0, runs: [] as unknown[] };
  try {
    const db = getDb();
    const rows = await db.select({
      id: schema.agentRuns.id,
      agent: schema.agentRuns.agent,
      phase: schema.agentRuns.phase,
      status: schema.agentRuns.status,
      engagementId: schema.agentRuns.engagementId,
      startedAt: schema.agentRuns.startedAt,
      endedAt: schema.agentRuns.endedAt,
    }).from(schema.agentRuns).orderBy(sql`${schema.agentRuns.startedAt} DESC`).limit(50);

    const engIds = [...new Set(rows.map(r => r.engagementId))];
    const engMap = new Map<string, string>();
    if (engIds.length > 0) {
      const engs = await db.select({ id: schema.engagements.id, name: schema.engagements.name }).from(schema.engagements);
      for (const e of engs) engMap.set(e.id, e.name);
    }

    agents = {
      running: rows.filter(r => r.status === "running").length,
      total: rows.length,
      runs: rows.map(r => ({ ...r, engagementName: engMap.get(r.engagementId) })),
    };
  } catch { /* DB might be down */ }

  return c.json({
    api: { ok: true, uptime: Math.floor((Date.now() - startTime) / 1000) },
    database,
    docker,
    containers,
    agents,
    websockets: { connections: getWsClientCount() },
  });
});

export default app;
