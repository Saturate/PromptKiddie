import { Hono } from "hono";
import {
  searchKnowledge,
  ingestDocument,
  clearSource,
  listSources,
} from "@promptkiddie/core";

const app = new Hono();

app.get("/knowledge", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = c.req.query("limit");
  const source = c.req.query("source");
  const mode = c.req.query("mode") as "hybrid" | "vector" | "keyword" | undefined;
  const results = await searchKnowledge(q, {
    limit: limit ? parseInt(limit, 10) : undefined,
    source,
    mode,
  });
  return c.json(results);
});

app.post("/knowledge/ingest", async (c) => {
  const body = await c.req.json();
  const count = await ingestDocument(body.content, body.metadata, body.chunkStrategy);
  return c.json({ chunksIngested: count }, 201);
});

app.get("/knowledge/sources", async (c) => {
  return c.json(await listSources());
});

app.delete("/knowledge/sources/:name", async (c) => {
  const removed = await clearSource(c.req.param("name"));
  return c.json({ removed });
});

export default app;
