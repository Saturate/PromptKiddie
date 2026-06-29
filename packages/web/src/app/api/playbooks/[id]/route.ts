import { NextRequest } from "next/server";
import { getPlaybook } from "@promptkiddie/core";
import { getDb } from "@promptkiddie/core";
import { eq } from "drizzle-orm";
import { schema } from "@promptkiddie/core";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await getPlaybook(id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  const [row] = await db
    .update(schema.playbooks)
    .set({
      name: body.name,
      description: body.description,
      phases: body.phases,
      updatedAt: new Date(),
    })
    .where(eq(schema.playbooks.id, id))
    .returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}
