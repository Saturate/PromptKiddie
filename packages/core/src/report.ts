/**
 * Report generator: builds a .typ (Typst) source file from engagement data,
 * then compiles it to PDF via `typst compile`.
 *
 * Shared by the CLI (`pk report generate`) and the web API route.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import {
  getEngagement,
  listFindings,
  listTargets,
  listActivity,
  listEvidence,
  listObjectives,
} from "./repo.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a string for use inside a Typst `"..."` literal. */
function escTypst(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Format a date as YYYY-MM-DD. */
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/** Format a timestamp as HH:MM. */
function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "--:--";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(11, 16);
}

/** Phase display labels. */
const phaseLabel: Record<string, string> = {
  scoping: "Scoping",
  recon: "Recon",
  enum: "Enum",
  exploit: "Exploit",
  postexploit: "Post-exploit",
  report: "Report",
};

// ── Public API ───────────────────────────────────────────────────────────────

export interface GenerateReportResult {
  typPath: string;
  pdfPath: string;
}

/**
 * Generate a Typst report and compile it to PDF.
 *
 * @param engagementId  UUID of the engagement
 * @param projectRoot   Absolute path to the PromptKiddie project root
 * @param outputDir     Override for the output directory (default: engagements/<slug>/)
 * @returns Paths to the generated .typ and .pdf files
 */
export async function generateReport(
  engagementId: string,
  projectRoot: string,
  outputDir?: string,
): Promise<GenerateReportResult> {
  // 1. Fetch all data
  const engagement = await getEngagement(engagementId);
  if (!engagement) throw new Error(`No engagement with id ${engagementId}`);

  const [findingsData, targetsData, activityData, evidenceData, objectivesData] =
    await Promise.all([
      listFindings(engagementId),
      listTargets(engagementId),
      listActivity(engagementId),
      listEvidence(engagementId),
      listObjectives(engagementId),
    ]);

  // 2. Determine output paths
  const outDir = outputDir ?? join(projectRoot, "engagements", engagement.slug);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const typPath = join(outDir, "report.typ");
  const pdfPath = join(outDir, "report.pdf");

  // 3. Compute the relative import path from the output dir to the template
  const templateAbsPath = join(projectRoot, "templates", "typst", "report.typ");
  const templateRel = relative(dirname(typPath), templateAbsPath).replace(/\\/g, "/");

  // 4. Build severity counts
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findingsData) {
    if (f.severity in severityCounts) {
      severityCounts[f.severity as keyof typeof severityCounts]++;
    }
  }

  // 5. Find primary target identifier for cover page
  const inScopeTargets = targetsData.filter((t) => t.inScope);
  const primaryTarget =
    inScopeTargets.length > 0
      ? inScopeTargets.map((t) => t.identifier).join(", ")
      : targetsData.length > 0
        ? targetsData.map((t) => t.identifier).join(", ")
        : undefined;

  // 6. Build the Typst source
  const lines: string[] = [];
  const ln = (s: string) => lines.push(s);

  // -- Import + show
  ln(`#import "${templateRel}": *`);
  ln("");
  ln("#show: pk-report.with(");
  ln(`  title: "${escTypst(engagement.name)}",`);
  if (engagement.scope) {
    ln(`  subtitle: "${escTypst(engagement.scope)}",`);
  }
  if (primaryTarget) {
    ln(`  target: "${escTypst(primaryTarget)}",`);
  }
  ln(`  engagement-type: "${engagement.type.toUpperCase()}",`);
  ln(`  assessor: "PromptKiddie Agent",`);
  ln(`  date: "${fmtDate(engagement.startedAt ?? engagement.createdAt)}",`);
  ln(`  classification: "CONFIDENTIAL",`);
  ln(")");
  ln("");

  // -- Executive Summary
  ln("= Executive Summary");
  ln("");

  const isCTF = engagement.type === "ctf";
  const confirmedFindings = findingsData.filter((f) => f.status === "confirmed" || f.status === "reported");
  const totalFindings = findingsData.length;

  if (isCTF) {
    const completed = objectivesData.filter((o) => o.completed).length;
    const total = objectivesData.length;
    ln(
      `${engagement.type.toUpperCase()} engagement against ${primaryTarget ?? "the target"}. ` +
      `${completed} of ${total} objectives completed. ` +
      `${totalFindings} finding${totalFindings === 1 ? "" : "s"} recorded ` +
      `(${confirmedFindings.length} confirmed).`
    );
  } else {
    ln(
      `Security assessment of ${primaryTarget ?? "the target"}. ` +
      `${totalFindings} finding${totalFindings === 1 ? "" : "s"} identified ` +
      `(${confirmedFindings.length} confirmed).`
    );
  }
  ln("");
  ln(
    `#severity-table(critical: ${severityCounts.critical}, high: ${severityCounts.high}, ` +
    `medium: ${severityCounts.medium}, low: ${severityCounts.low}, info: ${severityCounts.info})`
  );
  ln("");

  // -- Attack Chain (from exploit-phase activity log entries)
  const exploitActivity = activityData
    .filter((a) => a.phase === "exploit" || a.phase === "postexploit")
    .reverse(); // chronological order (activityData is desc)

  if (exploitActivity.length > 0) {
    ln("== Attack Chain");
    ln("");
    ln("#attack-chain((");
    for (const a of exploitActivity) {
      ln(`  "${escTypst(a.action)}",`);
    }
    ln("))");
    ln("");
  }

  // -- Findings
  if (findingsData.length > 0) {
    ln("= Findings");
    ln("");

    // Sort by severity: critical > high > medium > low > info
    const sevOrder = ["critical", "high", "medium", "low", "info"];
    const sorted = [...findingsData].sort(
      (a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity),
    );

    for (const f of sorted) {
      ln(`== ${escTypst(f.title)}`);
      ln("");
      ln("#finding-card(");
      ln(`  title: "${escTypst(f.title)}",`);
      ln(`  severity: "${f.severity}",`);
      if (f.cvss != null) ln(`  cvss: "${f.cvss}",`);
      if (f.owasp && f.owasp.length > 0) {
        ln(`  owasp: "${escTypst(f.owasp.join(", "))}",`);
      }
      if (f.attackTechniques && f.attackTechniques.length > 0) {
        ln(`  attack: "${escTypst(f.attackTechniques.join(", "))}",`);
      }
      if (f.cve && f.cve.length > 0) {
        ln(`  cve: "${escTypst(f.cve.join(", "))}",`);
      }
      ln(`  status: "${f.status}",`);
      ln(")");
      ln("");

      if (f.description) {
        ln("=== Description");
        ln("");
        ln(f.description);
        ln("");
      }

      if (f.remediation) {
        ln("=== Remediation");
        ln("");
        ln(f.remediation);
        ln("");
      }
    }
  }

  // -- Objectives (CTF only)
  if (isCTF && objectivesData.length > 0) {
    ln("= Objectives");
    ln("");
    for (const o of objectivesData) {
      ln(`== ${escTypst(o.title)}`);
      ln("");
      if (o.completed && o.flag) {
        ln(`#flag-captured("${escTypst(o.flag)}")`);
        ln("");
      }
      if (o.description) {
        ln(o.description);
        ln("");
      }
    }
  }

  // -- Timeline
  const chronological = [...activityData].reverse();
  if (chronological.length > 0) {
    ln("= Timeline");
    ln("");
    ln("#table(");
    ln("  columns: (auto, auto, 1fr),");
    ln("  [*Time*], [*Phase*], [*Action*],");
    for (const a of chronological) {
      const time = fmtTime(a.createdAt);
      const phase = phaseLabel[a.phase] ?? a.phase;
      ln(`  [${time}], [${phase}], [${escTypst(a.action)}],`);
    }
    ln(")");
    ln("");
  }

  // -- Recommendations
  if (findingsData.length > 0) {
    ln("= Recommendations");
    ln("");
    const sevOrder = ["critical", "high", "medium", "low", "info"];
    const sorted = [...findingsData].sort(
      (a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity),
    );
    for (const f of sorted) {
      if (f.remediation) {
        ln(`+ *${escTypst(f.title)}*: ${escTypst(f.remediation)}`);
      } else {
        ln(`+ *${escTypst(f.title)}*: Review and remediate.`);
      }
    }
    ln("");
  }

  // 7. Write the .typ file
  const typSource = lines.join("\n") + "\n";
  writeFileSync(typPath, typSource, "utf8");

  // 8. Compile to PDF (pass --root so typst can resolve the template import)
  const typstBin = findTypstBinary();
  try {
    execFileSync(typstBin, ["compile", "--root", projectRoot, typPath, pdfPath], {
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`typst compile failed: ${msg}`);
  }

  return { typPath, pdfPath };
}

/** Locate the typst binary. Checks common locations. */
function findTypstBinary(): string {
  // Check PATH first, then common install locations
  const candidates = [
    "typst",
    "/opt/homebrew/bin/typst",
    "/usr/local/bin/typst",
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { timeout: 5000, stdio: "ignore" });
      return c;
    } catch {
      // not found, try next
    }
  }
  throw new Error(
    "typst binary not found. Install it: https://github.com/typst/typst#installation",
  );
}
