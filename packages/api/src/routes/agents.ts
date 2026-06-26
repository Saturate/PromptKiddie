import { Hono } from "hono";
import {
  startAgentRun,
  listAgentRuns,
  finishAgentRun,
  addAgentLog,
  listAgentLog,
} from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/agent-runs", async (c) => {
  const body = await c.req.json();
  const row = await startAgentRun({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/agent-runs", async (c) => {
  return c.json(await listAgentRuns(c.req.param("engagementId")));
});

app.put("/agent-runs/:id/finish", async (c) => {
  const body = await c.req.json();
  const row = await finishAgentRun({ ...body, runId: c.req.param("id") });
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.post("/engagements/:engagementId/agent-log", async (c) => {
  const body = await c.req.json();
  const row = await addAgentLog({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/agent-log", async (c) => {
  return c.json(await listAgentLog(c.req.param("engagementId")));
});

export default app;
