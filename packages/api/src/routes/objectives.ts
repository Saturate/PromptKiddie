import { Hono } from "hono";
import { addObjective, listObjectives, updateObjective, captureFlag } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/objectives", async (c) => {
  const body = await c.req.json();
  const row = await addObjective({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/objectives", async (c) => {
  return c.json(await listObjectives(c.req.param("engagementId")));
});

app.patch("/objectives/:id", async (c) => {
  const body = await c.req.json();
  const row = await updateObjective(c.req.param("id"), body);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.put("/objectives/:id/capture", async (c) => {
  const body = await c.req.json();
  const row = await captureFlag(c.req.param("id"), body.flag);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
