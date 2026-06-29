import { NextRequest } from "next/server";
import { getPlaybook, getDb, schema } from "@promptkiddie/core";
import { eq } from "drizzle-orm";

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
  const isBlock = req.nextUrl.searchParams.get("type") === "block";

  if (isBlock) {
    const [row] = await db
      .update(schema.playbookBlocks)
      .set({ name: body.name, nodes: body.nodes, updatedAt: new Date() })
      .where(eq(schema.playbookBlocks.id, id))
      .returning();
    if (!row) return Response.json({ error: "Block not found" }, { status: 404 });
    return Response.json(row);
  }

  const [row] = await db
    .update(schema.playbooks)
    .set({ name: body.name, description: body.description, phases: body.phases, updatedAt: new Date() })
    .where(eq(schema.playbooks.id, id))
    .returning();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(row);
}
