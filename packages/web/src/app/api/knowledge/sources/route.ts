import { NextRequest, NextResponse } from "next/server";
import { KNOWLEDGE_SOURCES, listSources, clearSource } from "@promptkiddie/core";

export const dynamic = "force-dynamic";

export async function GET() {
  const ingested = await listSources();
  const ingestedMap = new Map(ingested.map((s) => [s.source, s]));

  const sources = KNOWLEDGE_SOURCES.map((src) => {
    const db = ingestedMap.get(src.name);
    return {
      name: src.name,
      repo: src.repo,
      category: src.category,
      description: src.description,
      chunks: db?.chunks ?? 0,
      lastIngested: db?.lastIngested ?? null,
      ingested: !!db,
    };
  });

  return NextResponse.json({ sources });
}

export async function DELETE(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });
  const count = await clearSource(source);
  return NextResponse.json({ cleared: count });
}
