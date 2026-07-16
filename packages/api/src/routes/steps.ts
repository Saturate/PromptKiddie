import { Hono } from "hono";
import {
  listEngagementSteps,
  initEngagementSteps,
  completeStep,
  skipStep,
  startStep,
  getNextSteps,
} from "@promptkiddie/core";

const app = new Hono();

app.get("/engagements/:engagementId/steps", async (c) => {
  return c.json(await listEngagementSteps(c.req.param("engagementId")));
});

app.post("/engagements/:engagementId/steps/init", async (c) => {
  const body = await c.req.json();
  const rows = await initEngagementSteps(c.req.param("engagementId"), body.playbookId);
  return c.json(rows, 201);
});

app.put("/engagements/:engagementId/steps/:key/complete", async (c) => {
  const body = await c.req.json();
  const result = body.type && body.id ? { type: body.type, id: body.id } : undefined;
  return c.json(await completeStep(c.req.param("engagementId"), c.req.param("key"), result));
});

app.put("/engagements/:engagementId/steps/:key/skip", async (c) => {
  const body = await c.req.json();
  return c.json(await skipStep(c.req.param("engagementId"), c.req.param("key"), body.reason));
});

app.put("/engagements/:engagementId/steps/:key/start", async (c) => {
  const body = await c.req.json();
  return c.json(await startStep(c.req.param("engagementId"), c.req.param("key"), body.agentId));
});

app.get("/engagements/:engagementId/steps/next", async (c) => {
  const max = c.req.query("max");
  return c.json(await getNextSteps(c.req.param("engagementId"), max ? parseInt(max, 10) : undefined));
});

export default app;
