import { NextRequest, NextResponse } from "next/server";
import { getEvidenceData } from "@promptkiddie/core";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await getEvidenceData(id);

  if (!row?.data) {
    return NextResponse.json({ error: "Evidence not found or no data stored" }, { status: 404 });
  }

  const forceDownload = req.nextUrl.searchParams.has("dl");
  const mime = row.mimeType ?? "application/octet-stream";
  const filename = row.path?.split("/").pop() ?? "evidence";
  const isViewable = !forceDownload && (mime.startsWith("image/") || mime.startsWith("text/") || mime === "application/pdf");

  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": isViewable ? "inline" : `attachment; filename="${filename}"`,
      "Content-Length": String(row.data.length),
    },
  });
}
