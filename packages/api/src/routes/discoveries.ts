import { Hono } from "hono";
import { addDiscovery, listDiscoveries, getDiscoverySummary } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/discoveries", async (c) => {
  const body = await c.req.json();
  const row = await addDiscovery({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/discoveries/summary", async (c) => {
  return c.json(await getDiscoverySummary(c.req.param("engagementId")));
});

app.get("/engagements/:engagementId/discoveries", async (c) => {
  const eid = c.req.param("engagementId");
  const category = c.req.query("category");
  const type = c.req.query("type");
  const opts: Record<string, string> = {};
  if (category) opts.category = category;
  if (type) opts.type = type;
  return c.json(await listDiscoveries(eid, Object.keys(opts).length ? opts : undefined));
});

export default app;
