import { listMessages, sendMessage, listEngagements } from "@promptkiddie/core";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const engagementId = req.nextUrl.searchParams.get("engagementId");
  if (engagementId === "all") {
    const engagements = await listEngagements();
    const allMsgs = (await Promise.all(engagements.map((e) => listMessages(e.id)))).flat();
    allMsgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return NextResponse.json(allMsgs.slice(-50));
  }
  if (!engagementId) {
    return NextResponse.json({ error: "engagementId required" }, { status: 400 });
  }
  const msgs = await listMessages(engagementId);
  return NextResponse.json(msgs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const result = await sendMessage(body);
  return NextResponse.json(result);
}
