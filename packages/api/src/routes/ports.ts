import { Hono } from "hono";
import { addPort, listPorts, updatePort } from "@promptkiddie/core";

const app = new Hono();

app.post("/targets/:targetId/ports", async (c) => {
  const body = await c.req.json();
  const row = await addPort({ ...body, targetId: c.req.param("targetId") });
  return c.json(row, 201);
});

app.get("/targets/:targetId/ports", async (c) => {
  return c.json(await listPorts(c.req.param("targetId")));
});

app.patch("/ports/:id", async (c) => {
  const body = await c.req.json();
  const row = await updatePort(c.req.param("id"), body);
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
