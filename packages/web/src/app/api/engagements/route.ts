import { listEngagements } from "@promptkiddie/core";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const engagements = await listEngagements();
  return NextResponse.json(
    engagements.map((e) => ({ id: e.id, name: e.name, phase: e.phase })),
  );
}
