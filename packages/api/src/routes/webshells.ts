import { Hono } from "hono";
import { registerWebshell, listWebshells, getWebshell } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/webshells", async (c) => {
  const body = await c.req.json();
  const row = await registerWebshell(c.req.param("engagementId"), body);
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/webshells", async (c) => {
  return c.json(await listWebshells(c.req.param("engagementId")));
});

app.get("/engagements/:engagementId/webshells/:nameOrUrl", async (c) => {
  const row = await getWebshell(c.req.param("engagementId"), decodeURIComponent(c.req.param("nameOrUrl")));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
