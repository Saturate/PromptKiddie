import { Hono } from "hono";
import { emitEvent, listEvents } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/events", async (c) => {
  const body = await c.req.json();
  const eid = c.req.param("engagementId");
  const row = await emitEvent(eid, body.type, body.payload, body.source);
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/events", async (c) => {
  const eid = c.req.param("engagementId");
  const type = c.req.query("type");
  return c.json(await listEvents(eid, type ? { type } : undefined));
});

export default app;
