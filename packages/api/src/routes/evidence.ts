import { Hono } from "hono";
import { addEvidence, listEvidence, getEvidenceData } from "@promptkiddie/core";

const app = new Hono();

app.post("/engagements/:engagementId/evidence", async (c) => {
  const body = await c.req.json();
  const row = await addEvidence({ ...body, engagementId: c.req.param("engagementId") });
  return c.json(row, 201);
});

app.get("/engagements/:engagementId/evidence", async (c) => {
  return c.json(await listEvidence(c.req.param("engagementId")));
});

app.get("/evidence/:id/data", async (c) => {
  const row = await getEvidenceData(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
