import { getAllSettings, setSetting, seedDefaultSettings } from "@promptkiddie/core";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  await seedDefaultSettings();
  const rows = await getAllSettings();
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  const body = await req.json();
  const results: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    await setSetting(key, value);
    results[key] = value;
  }
  return NextResponse.json(results);
}
