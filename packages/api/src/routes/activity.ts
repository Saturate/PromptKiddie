import { Hono } from "hono";
import { logActivity, listActivity } from "@promptkiddie/core";
import type { KeyIdentity } from "../middleware/auth.js";

const app = new Hono();

app.post("/engagements/:engagementId/activity", async (c) => {
  const body = await c.req.json();
  const identity = c.get("keyIdentity") as KeyIdentity | undefined;
  const row = await logActivity({
    ...body,
    engagementId: c.req.param("engagementId"),
    actor: identity?.raw ?? body.actor,
    created_by: identity?.raw,
  });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/activity", async (c) => {
  return c.json(await listActivity(c.req.param("engagementId")));
});

export default app;
