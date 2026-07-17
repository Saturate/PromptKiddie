import { Hono } from "hono";
import {
  listPlaybooks,
  getDefaultPlaybook,
  getPlaybook,
  createPlaybook,
  updatePlaybook,
} from "@promptkiddie/core";

const app = new Hono();

app.get("/playbooks", async (c) => {
  return c.json(await listPlaybooks());
});

app.get("/playbooks/default/:type", async (c) => {
  const pb = await getDefaultPlaybook(c.req.param("type"));
  if (!pb) return c.json({ error: "no default playbook for this type" }, 404);
  return c.json(pb);
});

app.get("/playbooks/:id", async (c) => {
  const pb = await getPlaybook(c.req.param("id"));
  if (!pb) return c.json({ error: "not found" }, 404);
  return c.json(pb);
});

app.post("/playbooks", async (c) => {
  const body = await c.req.json();
  return c.json(await createPlaybook(body), 201);
});

app.patch("/playbooks/:id", async (c) => {
  const body = await c.req.json();
  return c.json(await updatePlaybook(c.req.param("id"), body));
});

export default app;
