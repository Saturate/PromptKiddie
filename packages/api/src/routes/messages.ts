import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sendMessage, listMessages, pollInbox, subscribeMessages } from "@promptkiddie/core";

const app = new Hono();

app.post("/messages", async (c) => {
  const body = await c.req.json();
  const row = await sendMessage(body);
  return c.json(row, 201);
});

app.get("/messages", async (c) => {
  const engagementId = c.req.query("engagementId");
  if (!engagementId) return c.json({ error: "engagementId query param required" }, 400);
  return c.json(await listMessages(engagementId));
});

app.get("/messages/poll", async (c) => {
  const engagementId = c.req.query("engagementId");
  return c.json(await pollInbox(engagementId));
});

app.get("/messages/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const unsub = await subscribeMessages((payload) => {
      stream.writeSSE({ data: JSON.stringify(payload), event: "message" });
    });
    stream.onAbort(() => unsub());
  });
});

export default app;
