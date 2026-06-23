import { listMessages } from "@promptkiddie/core";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const engagementId = req.nextUrl.searchParams.get("engagementId");
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId required" }, { status: 400 });
  }
  const msgs = await listMessages(engagementId);
  return NextResponse.json(msgs);
}
