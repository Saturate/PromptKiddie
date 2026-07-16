import { Hono } from "hono";
import {
  addService,
  updateService,
  addServiceApp,
  addServiceCred,
  addServiceCve,
  listServices,
  getService,
  listAllCreds,
} from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/services", async (c) => {
  const body = await c.req.json();
  const row = await addService({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/services", async (c) => {
  const targetId = c.req.query("targetId");
  return c.json(await listServices(c.req.param("engagementId"), targetId ? { targetId } : undefined));
});

app.patch("/services/:id", async (c) => {
  const body = await c.req.json();
  const row = await updateService(c.req.param("id"), body);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.get("/services/:id", async (c) => {
  const row = await getService(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

app.post("/services/:id/apps", async (c) => {
  const body = await c.req.json();
  const row = await addServiceApp(c.req.param("id"), body);
  return c.json(row, 201);
});

app.post("/services/:id/creds", async (c) => {
  const body = await c.req.json();
  const row = await addServiceCred(c.req.param("id"), body);
  return c.json(row, 201);
});

app.post("/services/:id/cves", async (c) => {
  const body = await c.req.json();
  const row = await addServiceCve(c.req.param("id"), body);
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/creds", async (c) => {
  return c.json(await listAllCreds(c.req.param("engagementId")));
});

export default app;
