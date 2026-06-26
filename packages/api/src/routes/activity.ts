import { Hono } from "hono";
import { logActivity, listActivity } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/activity", async (c) => {
  const body = await c.req.json();
  const row = await logActivity({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/activity", async (c) => {
  return c.json(await listActivity(c.req.param("engagementId")));
});

export default app;
