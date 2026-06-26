import { Hono } from "hono";
import {
  createEngagement,
  listEngagements,
  getEngagement,
  updateEngagement,
  deleteEngagement,
  setEngagementStatus,
  getPhase,
  advancePhase,
} from "@promptkiddie/core";

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json();
  const row = await createEngagement(body);
  return c.json(row, 201);
});

app.get("/", async (c) => {
  return c.json(await listEngagements());
});

app.get("/:id", async (c) => {
  const row = await getEngagement(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.patch("/:id", async (c) => {
  const body = await c.req.json();
  const row = await updateEngagement(c.req.param("id"), body);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.delete("/:id", async (c) => {
  const row = await deleteEngagement(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.put("/:id/status", async (c) => {
  const body = await c.req.json();
  const row = await setEngagementStatus(c.req.param("id"), body.status);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.get("/:id/phase", async (c) => {
  const result = await getPhase(c.req.param("id"));
  return c.json(result);
});

app.put("/:id/phase", async (c) => {
  const body = await c.req.json();
  const result = await advancePhase(c.req.param("id"), body.phase);
  return c.json(result);
});

export default app;
