import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { generateReport, getEngagement } from "@promptkiddie/core";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Walk up from cwd to find the monorepo root (contains pnpm-workspace.yaml). */
function findProjectRoot(): string {
  let dir = resolve(process.cwd());
  while (dir !== "/") {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const engagement = await getEngagement(id);
  if (!engagement) {
    return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  }

  const projectRoot = findProjectRoot();

  let pdfPath: string;
  try {
    const result = await generateReport(id, projectRoot);
    pdfPath = result.pdfPath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Report generation failed: ${message}` }, { status: 500 });
  }

  if (!existsSync(pdfPath)) {
    return NextResponse.json({ error: "PDF file not found after generation" }, { status: 500 });
  }

  const pdf = readFileSync(pdfPath);
  const filename = `${engagement.slug}-report.pdf`;

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
    },
  });
}
