import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { source } = await req.json();
  if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });

  const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const proc = execFile(
      "node",
      ["packages/cli/dist/index.js", "knowledge", "pull", source],
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 600000,
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
        });
      },
    );
    proc.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 1 }));
  });

  return NextResponse.json({
    ok: result.code === 0,
    output: result.stderr || result.stdout,
  });
}
