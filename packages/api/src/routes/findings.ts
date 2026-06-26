import { Hono } from "hono";
import { addFinding, listFindings, updateFinding } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/findings", async (c) => {
  const body = await c.req.json();
  const row = await addFinding({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/findings", async (c) => {
  return c.json(await listFindings(c.req.param("engagementId")));
});

app.patch("/findings/:id", async (c) => {
  const body = await c.req.json();
  const row = await updateFinding(c.req.param("id"), body);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
