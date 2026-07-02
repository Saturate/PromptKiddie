import { NextRequest, NextResponse } from "next/server";
import { searchKnowledge, listSources } from "@promptkiddie/core";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  const mode = req.nextUrl.searchParams.get("mode") as "hybrid" | "vector" | "keyword" | null;
  const source = req.nextUrl.searchParams.get("source") || undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 10;

  if (!query) {
    const sources = await listSources();
    return NextResponse.json({ sources });
  }

  const results = await searchKnowledge(query, {
    limit,
    mode: mode ?? "hybrid",
    source,
  });

  return NextResponse.json({ results });
}
