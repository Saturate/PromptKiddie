import { Hono } from "hono";
import { addArtifact, listArtifacts } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/artifacts", async (c) => {
  const body = await c.req.json();
  const row = await addArtifact({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/artifacts", async (c) => {
  return c.json(await listArtifacts(c.req.param("engagementId")));
});

export default app;
