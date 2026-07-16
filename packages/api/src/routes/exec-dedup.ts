import { Hono } from "hono";
import { recordExecOutcome, getExecDedup, isExecBlocked } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/exec-dedup", async (c) => {
  const body = await c.req.json();
  const eid = c.req.param("engagementId");
  const row = await recordExecOutcome(eid, body.command, body.target, body.exitCode, body.outcomeSummary);
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/exec-dedup", async (c) => {
  return c.json(await getExecDedup(c.req.param("engagementId")));
});

app.get("/engagements/:engagementId/exec-dedup/blocked", async (c) => {
  const eid = c.req.param("engagementId");
  const command = c.req.query("command") ?? "";
  const target = c.req.query("target") ?? "";
  const blocked = await isExecBlocked(eid, command, target);
  return c.json(blocked);
});

export default app;
