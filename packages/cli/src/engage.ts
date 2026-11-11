import { existsSync, mkdirSync, writeFileSync, symlinkSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { getRepo, loadConfig } from "@promptkiddie/core";
import { renderAgentsMd, renderEnv, renderGitignore, renderSettings, type WorkspaceVars } from "./templates/index.js";
import { guardSourceRepo } from "./guards.js";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

function ok(msg: string) { console.log(`  ${green("+")} ${msg}`); }
function skip(msg: string) { console.log(`  ${dim("-")} ${msg} ${dim("(exists)")}`); }

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function writeIfMissing(path: string, content: string, label: string): boolean {
  if (existsSync(path)) { skip(label); return false; }
  writeFileSync(path, content);
  ok(label);
  return true;
}

export interface EngageOptions {
  target?: string;
  type?: string;
  scope?: string;
  vpn?: string;
  open?: boolean;
  baseDir?: string;
  force?: boolean;
}

export async function engage(name: string, opts: EngageOptions): Promise<void> {
  guardSourceRepo(process.cwd(), "engage", opts.force);

  const config = loadConfig();
  const repo = getRepo();
  const slug = slugify(name);
  const baseDir = opts.baseDir ?? process.env.PK_ENGAGEMENTS_DIR ?? join(homedir(), "engagements");
  const wsDir = resolve(baseDir, slug);

  console.log();
  console.log(`  ${bold("PK Engage")} ${dim(name)}`);
  console.log();

  // Create workspace directory
  if (!existsSync(wsDir)) {
    mkdirSync(wsDir, { recursive: true });
    ok(`Created ${wsDir}`);
  } else {
    skip(wsDir);
  }

  // Create engagement in DB
  let engagementId: string;
  try {
    const eng = await repo.createEngagement({
      name,
      type: (opts.type ?? "ctf") as "ctf" | "whitebox" | "blackbox" | "bugbounty",
      scope: opts.scope,
    }) as { id: string };
    engagementId = eng.id;
    ok(`Engagement created: ${engagementId}`);
  } catch (err) {
    console.error(`  ${red("!")} Failed to create engagement: ${err instanceof Error ? err.message : err}`);
    console.error(`    Is the PK API running? Check: ${config.api.url}`);
    process.exit(1);
  }

  // Add target if provided
  if (opts.target) {
    try {
      await repo.addTarget({
        engagementId,
        identifier: opts.target,
        kind: opts.target.includes("/") ? "network" : "host",
        inScope: true,
      });
      ok(`Target added: ${opts.target}`);
    } catch (err) {
      console.error(`  ${red("!")} Failed to add target: ${err instanceof Error ? err.message : err}`);
    }
  }

  const vars: WorkspaceVars = {
    name,
    engagementId,
    target: opts.target ?? "see engagement",
    type: opts.type ?? "ctf",
    scope: opts.scope ?? "",
    apiUrl: config.api.url ?? "",
  };

  // Write workspace files
  writeIfMissing(join(wsDir, "AGENTS.md"), renderAgentsMd(vars), "AGENTS.md");

  const claudePath = join(wsDir, "CLAUDE.md");
  if (!existsSync(claudePath)) {
    symlinkSync("AGENTS.md", claudePath);
    ok("CLAUDE.md -> AGENTS.md");
  } else {
    skip("CLAUDE.md");
  }

  writeIfMissing(join(wsDir, ".env"), renderEnv(vars), ".env");
  writeIfMissing(join(wsDir, ".gitignore"), renderGitignore(), ".gitignore");

  // .claude/settings.local.json
  const claudeDir = join(wsDir, ".claude");
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });
  writeIfMissing(join(claudeDir, "settings.local.json"), renderSettings(vars), ".claude/settings.local.json");

  // Evidence subdirectories
  const evidenceDirs = ["recon", "enum", "exploit", "loot", "report"];
  const engDir = join(wsDir, "engagements", slug);
  if (!existsSync(engDir)) mkdirSync(engDir, { recursive: true });
  for (const sub of evidenceDirs) {
    const p = join(engDir, sub);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  ok(`engagements/${slug}/ (${evidenceDirs.join(", ")})`);

  // VPN config
  if (opts.vpn) {
    const vpnDir = join(wsDir, "vpn");
    if (!existsSync(vpnDir)) mkdirSync(vpnDir, { recursive: true });
    const dest = join(vpnDir, opts.vpn.split("/").pop()!);
    copyFileSync(opts.vpn, dest);
    ok(`VPN config: ${dest}`);
  }

  // Start worker container
  console.log();
  const workerName = `pk-worker-${slug}`;
  try {
    // Check if already running
    const running = execFileSync("docker", ["ps", "-q", "--filter", `name=${workerName}`], { timeout: 5000 }).toString().trim();
    if (running) {
      skip(`Worker container ${workerName} already running`);
    } else {
      console.log(`  ${dim("Starting worker container...")}`);
      execFileSync("docker", [
        "run", "-d",
        "--name", workerName,
        "--network", "pk-network",
        "-e", `ENGAGEMENT_ID=${engagementId}`,
        "-e", `ENGAGEMENT_SLUG=${slug}`,
        "-e", "PK_CONTAINER=1",
        "-v", `${engDir}:/workspace/engagements/${slug}`,
        "pk-agent",
        "sleep", "infinity",
      ], { timeout: 30000 });
      ok(`Worker container: ${workerName}`);
    }
  } catch (err) {
    console.error(`  ${red("!")} Worker container failed: ${err instanceof Error ? err.message : err}`);
    console.error(`    You can start it manually later.`);
  }

  // Summary
  console.log();
  console.log(`  ${bold(green("PK is ready."))}`);
  console.log();
  console.log(`  Workspace:   ${wsDir}`);
  console.log(`  Engagement:  ${engagementId}`);
  if (opts.target) console.log(`  Target:      ${opts.target}`);
  console.log();
  console.log(`  Next: open this directory in Claude Code:`);
  console.log(`    ${dim(`cd ${wsDir} && claude`)}`);
  console.log();

  // Open in Claude Code if requested
  if (opts.open) {
    try {
      execFileSync("claude", [wsDir], { stdio: "inherit", timeout: 5000 });
    } catch {
      try {
        execFileSync("code", [wsDir], { stdio: "inherit", timeout: 5000 });
      } catch {}
    }
  }
}
