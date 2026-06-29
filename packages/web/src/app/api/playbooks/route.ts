import { NextRequest } from "next/server";
import { listPlaybooks, getDb, schema } from "@promptkiddie/core";

export async function GET(req: NextRequest) {
  const isBlocks = req.nextUrl.searchParams.has("blocks");
  if (isBlocks) {
    const db = getDb();
    const rows = await db.select().from(schema.playbookBlocks).orderBy(schema.playbookBlocks.name);
    return Response.json(rows);
  }
  const rows = await listPlaybooks();
  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const db = getDb();
  const [row] = await db.insert(schema.playbooks).values({
    name: body.name,
    engagementType: body.engagementType ?? "ctf",
    description: body.description ?? null,
    isDefault: false,
    phases: body.phases ?? [],
  }).returning();
  return Response.json(row);
}
