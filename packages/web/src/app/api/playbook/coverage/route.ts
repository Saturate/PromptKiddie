import { CTF_ACTIONS, PENTEST_PLAYBOOK } from "@promptkiddie/core";
import { execSync } from "child_process";
import { NextRequest } from "next/server";
import path from "path";

export const dynamic = "force-dynamic";

interface VitestResult {
  testResults: Array<{
    assertionResults: Array<{
      ancestorTitles: string[];
      title: string;
      fullName: string;
      status: "passed" | "failed" | "pending";
    }>;
  }>;
}

const PLAYBOOKS = { ctf: CTF_ACTIONS, pentest: PENTEST_PLAYBOOK } as const;
const CACHE_TTL_MS = 30_000;

let cachedResult: { json: string; timestamp: number } | null = null;

function runVitest(): string {
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return cachedResult.json;
  }

  const coreDir = path.resolve(process.cwd(), "../core");
  let vitestJson: string;
  try {
    vitestJson = execSync("npx vitest run --reporter=json 2>/dev/null", {
      cwd: coreDir,
      timeout: 15000,
      encoding: "utf-8",
    });
  } catch (err) {
    const output = (err as { stdout?: string }).stdout ?? "";
    if (!output.startsWith("{")) throw new Error("vitest run failed");
    vitestJson = output;
  }

  cachedResult = { json: vitestJson, timestamp: Date.now() };
  return vitestJson;
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("playbook") ?? "ctf";
  const playbook = PLAYBOOKS[key as keyof typeof PLAYBOOKS] ?? CTF_ACTIONS;
  const actionNames = playbook.actions.map((a) => a.name);

  let vitestJson: string;
  try {
    vitestJson = runVitest();
  } catch {
    return Response.json({ error: "vitest run failed" }, { status: 500 });
  }

  let data: VitestResult;
  try {
    data = JSON.parse(vitestJson);
  } catch {
    return Response.json({ error: "failed to parse vitest output" }, { status: 500 });
  }

  const allTests = data.testResults.flatMap((f) => f.assertionResults);

  const coverage: Record<string, "pass" | "fail" | "untested"> = {};
  for (const name of actionNames) {
    const matching = allTests.filter((t) => {
      const text = t.fullName.toLowerCase();
      return text.includes(name.toLowerCase());
    });

    if (matching.length === 0) {
      coverage[name] = "untested";
    } else if (matching.some((t) => t.status === "failed")) {
      coverage[name] = "fail";
    } else {
      coverage[name] = "pass";
    }
  }

  const summary = {
    total: actionNames.length,
    tested: Object.values(coverage).filter((v) => v !== "untested").length,
    passing: Object.values(coverage).filter((v) => v === "pass").length,
    failing: Object.values(coverage).filter((v) => v === "fail").length,
    untested: Object.values(coverage).filter((v) => v === "untested").length,
  };

  return Response.json({ coverage, summary });
}
