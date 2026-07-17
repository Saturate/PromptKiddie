import { Hono } from "hono";
import { getAllSettings, getSetting, setSetting } from "@promptkiddie/core";

const app = new Hono();

app.get("/settings", async (c) => {
  return c.json(await getAllSettings());
});

app.get("/settings/:key", async (c) => {
  const val = await getSetting(c.req.param("key"));
  if (val === undefined) return c.json({ error: "not found" }, 404);
  return c.json(val);
});

app.put("/settings", async (c) => {
  const body = await c.req.json() as Record<string, unknown>;
  for (const [key, value] of Object.entries(body)) {
    await setSetting(key, value);
  }
  return c.json(await getAllSettings());
});

export default app;
