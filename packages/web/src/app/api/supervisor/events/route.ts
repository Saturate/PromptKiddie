import { NextRequest } from "next/server";
import { getDb } from "@promptkiddie/core";
import { sql } from "drizzle-orm";

/**
 * SSE endpoint that streams engagement events in real time.
 * The supervisor writes events to DB + NOTIFY; this endpoint polls
 * the events table and pushes new rows to the frontend.
 *
 * GET /api/supervisor/events?engagementId=<uuid>
 */
export async function GET(req: NextRequest) {
  const engagementId = req.nextUrl.searchParams.get("engagementId");
  if (!engagementId) {
    return new Response("Missing engagementId", { status: 400 });
  }

  const encoder = new TextEncoder();
  let lastEventId = "";
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const poll = async () => {
        if (closed) return;
        try {
          const db = getDb();
          const query = lastEventId
            ? sql`SELECT id, type, payload, source, created_at FROM events
                  WHERE engagement_id = ${engagementId} AND created_at > (
                    SELECT created_at FROM events WHERE id = ${lastEventId}
                  ) ORDER BY created_at ASC LIMIT 50`
            : sql`SELECT id, type, payload, source, created_at FROM events
                  WHERE engagement_id = ${engagementId}
                  ORDER BY created_at DESC LIMIT 10`;

          const result = await db.execute(query);
          const rows = result.rows as Array<{
            id: string;
            type: string;
            payload: Record<string, unknown>;
            source: string;
            created_at: string;
          }>;

          const sorted = lastEventId ? rows : rows.reverse();

          for (const row of sorted) {
            send({
              id: row.id,
              type: row.type,
              payload: row.payload,
              source: row.source,
              createdAt: row.created_at,
            });
            lastEventId = row.id;
          }
        } catch {
          // DB not ready yet
        }

        if (!closed) {
          setTimeout(poll, 1000);
        }
      };

      send({ type: "connected", payload: { engagementId } });
      await poll();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
