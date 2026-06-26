import { Hono } from "hono";
import { addTarget, listTargets, updateTarget } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/targets", async (c) => {
  const body = await c.req.json();
  const row = await addTarget({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/targets", async (c) => {
  return c.json(await listTargets(c.req.param("engagementId")));
});

app.patch("/targets/:id", async (c) => {
  const body = await c.req.json();
  const row = await updateTarget(c.req.param("id"), body);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
