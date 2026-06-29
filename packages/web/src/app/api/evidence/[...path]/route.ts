// Deprecated: use /api/evidence/[id] instead
export function GET() {
  return Response.json({ error: "Use /api/evidence/[id] instead" }, { status: 410 });
}
