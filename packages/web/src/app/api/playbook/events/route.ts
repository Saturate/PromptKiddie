import { getDb, schema } from "@promptkiddie/core";
import { eq, asc } from "drizzle-orm";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const engagementId = req.nextUrl.searchParams.get("engagement");
  if (!engagementId) {
    return Response.json({ error: "engagement query param required" }, { status: 400 });
  }

  const db = getDb();
  const rows = await db
    .select({
      id: schema.events.id,
      type: schema.events.type,
      payload: schema.events.payload,
      source: schema.events.source,
      createdAt: schema.events.createdAt,
    })
    .from(schema.events)
    .where(eq(schema.events.engagementId, engagementId))
    .orderBy(asc(schema.events.createdAt));

  return Response.json(rows);
}
