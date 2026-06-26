import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") ?? "anthropic";
  const baseUrl = req.nextUrl.searchParams.get("baseUrl") ?? "";

  try {
    switch (provider) {
      case "anthropic": {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return NextResponse.json({ models: [], error: "ANTHROPIC_API_KEY not set" });
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        });
        if (!res.ok) return NextResponse.json({ models: [], error: `API ${res.status}` });
        const data = await res.json();
        const models = (data.data ?? []).map((m: { id: string }) => m.id).sort();
        return NextResponse.json({ models });
      }

      case "openai": {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return NextResponse.json({ models: [], error: "OPENAI_API_KEY not set" });
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) return NextResponse.json({ models: [], error: `API ${res.status}` });
        const data = await res.json();
        const models = (data.data ?? [])
          .map((m: { id: string }) => m.id)
          .filter((id: string) => id.startsWith("gpt-") || id.startsWith("o"))
          .sort();
        return NextResponse.json({ models });
      }

      case "custom": {
        if (!baseUrl) return NextResponse.json({ models: [], error: "Base URL required" });
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`);
        if (!res.ok) return NextResponse.json({ models: [], error: `API ${res.status}` });
        const data = await res.json();
        const models = (data.data ?? data.models ?? [])
          .map((m: { id?: string; name?: string }) => m.id ?? m.name)
          .filter(Boolean)
          .sort();
        return NextResponse.json({ models });
      }

      default:
        return NextResponse.json({ models: [] });
    }
  } catch (err) {
    return NextResponse.json({ models: [], error: (err as Error).message });
  }
}
