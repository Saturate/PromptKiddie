import { existsSync } from "node:fs";
import { join, dirname, parse } from "node:path";

const MARKER = ".pksource";

const HARD_BLOCK = new Set(["exec"]);

export function isSourceRepo(cwd: string): boolean {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, MARKER))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export type GuardResult = "block" | "warn" | "ok";

export function checkSourceRepo(cwd: string, command: string): GuardResult {
  if (!isSourceRepo(cwd)) return "ok";
  return HARD_BLOCK.has(command) ? "block" : "warn";
}

export function guardSourceRepo(cwd: string, command: string, force = false): void {
  if (force) return;
  const result = checkSourceRepo(cwd, command);
  if (result === "ok") return;

  const msg = [
    "",
    "\x1b[33m⚠ Running engagement commands from the PK source repo.\x1b[0m",
    "  Use a workspace directory instead:",
    "",
    "    pk engage <name> --target <ip>",
    "    cd ~/engagements/<name>",
    "",
  ].join("\n");

  if (result === "block") {
    console.error(msg);
    console.error("  \x1b[31mBlocked:\x1b[0m `pk " + command + "` cannot run from the source repo.");
    console.error("  Use --force to override.\n");
    process.exit(1);
  }

  console.error(msg);
}
