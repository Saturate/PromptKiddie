#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { get } from "node:https";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version: VERSION } = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const REPO_RAW = `https://raw.githubusercontent.com/Saturate/PromptKiddie/v${VERSION}`;
const REPO_RAW_MAIN = "https://raw.githubusercontent.com/Saturate/PromptKiddie/main";

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ${green("+")} ${msg}`); }
function skip(msg: string) { console.log(`  ${dim("-")} ${msg} ${dim("(exists)")}`); }

// ── Arrow-key selector ──────────────────────────────────────────

interface SelectOption {
  label: string;
  hint: string;
}

// Shared readline for non-TTY mode (one interface for all questions)
let sharedRl: ReturnType<typeof createInterface> | null = null;
let stdinLines: string[] = [];
let stdinReady = false;

function initNonTtyInput(): void {
  if (stdinReady) return;
  stdinReady = true;
  sharedRl = createInterface({ input: process.stdin });
  sharedRl.on("line", (line) => stdinLines.push(line));
  sharedRl.on("close", () => { sharedRl = null; });
}

function select(question: string, options: SelectOption[], defaultIdx = 0): Promise<number> {
  return new Promise((resolvePromise) => {
    if (!process.stdin.isTTY) {
      initNonTtyInput();
      for (let i = 0; i < options.length; i++) {
        const hint = options[i].hint ? dim(` - ${options[i].hint}`) : "";
        log(`  ${i + 1}) ${options[i].label}${hint}`);
      }
      // Wait a tick for buffered lines to arrive
      setTimeout(() => {
        const answer = stdinLines.shift() ?? "";
        const idx = parseInt(answer.trim(), 10) - 1;
        log(`${cyan("?")} ${bold(question)} ${green(options[idx >= 0 && idx < options.length ? idx : defaultIdx].label)}`);
        resolvePromise(idx >= 0 && idx < options.length ? idx : defaultIdx);
      }, 10);
      return;
    }

    let cursor = defaultIdx;
    const lineCount = options.length + 1;

    function render() {
      // Move up to start of selector (except first render)
      process.stdout.write(`  ${cyan("?")} ${bold(question)}\n`);
      for (let i = 0; i < options.length; i++) {
        const prefix = i === cursor ? green("> ") : "  ";
        const label = i === cursor ? bold(options[i].label) : options[i].label;
        const hint = options[i].hint ? dim(` - ${options[i].hint}`) : "";
        process.stdout.write(`    ${prefix}${label}${hint}\n`);
      }
    }

    function clear() {
      // Move cursor up and clear each line
      for (let i = 0; i < lineCount; i++) {
        process.stdout.write("\x1b[A\x1b[2K");
      }
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    render();

    const onData = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x03") {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        console.log();
        process.exit(0);
      }

      if (key === "\r" || key === "\n") {
        // Enter - select current option
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        clear();
        const hint = options[cursor].hint ? dim(` - ${options[cursor].hint}`) : "";
        log(`${cyan("?")} ${bold(question)} ${green(options[cursor].label)}${hint}`);
        resolvePromise(cursor);
        return;
      }

      if (key === "\x1b[A" || key === "k") {
        // Up arrow or k
        clear();
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === "\x1b[B" || key === "j") {
        // Down arrow or j
        clear();
        cursor = (cursor + 1) % options.length;
        render();
      }
    };

    process.stdin.on("data", onData);
  });
}

// ── HTTP helpers ────────────────────────────────────────────────

class HttpError extends Error {
  constructor(public statusCode: number, url: string) {
    super(`HTTP ${statusCode} fetching ${url}`);
  }
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let redirects = 0;
    const request = (u: string) => {
      const req = get(u, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          if (++redirects > MAX_REDIRECTS) {
            res.resume();
            reject(new Error(`Too many redirects following ${url}`));
            return;
          }
          res.resume();
          req.removeAllListeners("timeout");
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new HttpError(res.statusCode ?? 0, u));
          return;
        }
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => resolvePromise(data));
        res.on("error", reject);
      });
      req.setTimeout(TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Timed out fetching ${u}`));
      });
      req.on("error", reject);
    };
    request(url);
  });
}

async function fetchFile(remotePath: string): Promise<string> {
  try {
    return await httpGet(`${REPO_RAW}/${remotePath}`);
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) {
      return await httpGet(`${REPO_RAW_MAIN}/${remotePath}`);
    }
    throw err;
  }
}

type DownloadResult = "created" | "skipped" | "failed";

async function download(remotePath: string, dest: string, label: string): Promise<DownloadResult> {
  if (existsSync(dest)) { skip(label); return "skipped"; }
  try {
    const content = await fetchFile(remotePath);
    writeFileSync(dest, content);
    ok(label);
    return "created";
  } catch (err) {
    log(red(`Failed to download ${label}: ${err instanceof Error ? err.message : err}`));
    return "failed";
  }
}

function writeIfMissing(path: string, content: string, label: string): boolean {
  if (existsSync(path)) { skip(label); return false; }
  writeFileSync(path, content);
  ok(label);
  return true;
}

function checkCommand(cmd: string): boolean {
  try { execSync(`command -v ${cmd}`, { stdio: "pipe" }); return true; }
  catch { return false; }
}

function openBrowser(url: string): void {
  const cmds: Record<string, string[]> = {
    darwin: ["open", url],
    linux: ["xdg-open", url],
    win32: ["cmd.exe", "/c", "start", url],
  };
  const cmd = cmds[process.platform];
  if (!cmd) return;
  try { execSync(cmd.join(" "), { stdio: "ignore" }); } catch {}
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// ── Main ────────────────────────────────────────────────────────

interface InitConfig {
  mode: "host" | "hosted";
  vpn: boolean;
  startDocker: boolean;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  ${bold("@promptkiddie/init")} v${VERSION}

  Scaffold a PromptKiddie workspace.

  ${bold("Usage:")}
    npx @promptkiddie/init [directory]

  ${bold("What it creates:")}
    docker-compose.yml    Postgres + Chrome + Gleipnir (+ web/api/orchestrator in hosted mode)
    .env                  Database and provider config
    AGENTS.md             Orchestrator instructions
    CLAUDE.md             Symlink to AGENTS.md
    .gitignore            Ignores .env, engagements/, .pk/
    engagements/          Evidence storage
    vpn/                  VPN config (when --vpn)

  ${bold("Options:")}
    --mode <host|hosted>  Host: agent runs locally. Hosted: everything in Docker.
    --vpn                 Scaffold vpn/ directory for HTB/THM/PG
    --no-docker           Skip docker compose up
    --help, -h            Show this help
    --version, -v         Show version

  ${bold("Examples:")}
    npx @promptkiddie/init                          Interactive setup
    npx @promptkiddie/init --mode host              Non-interactive, host mode
    npx @promptkiddie/init --mode hosted --vpn      Non-interactive, hosted + VPN
`);
    process.exit(0);
  }

  const targetDir = args.find(a => !a.startsWith("-") && a !== getFlag(args, "--mode")) || ".";
  const cwd = resolve(process.cwd(), targetDir);

  console.log();
  console.log(`  ${bold("PromptKiddie")} ${dim(`v${VERSION}`)}`);
  console.log();

  // Parse flags for non-interactive mode
  const modeFlag = getFlag(args, "--mode") as "host" | "hosted" | undefined;
  if (modeFlag && modeFlag !== "host" && modeFlag !== "hosted") {
    log(red(`Invalid mode "${modeFlag}". Use "host" or "hosted".`));
    process.exit(1);
  }

  const vpnFlag = args.includes("--vpn");
  const noDockerflag = args.includes("--no-docker");
  const nonInteractive = modeFlag != null;

  // Resolve config: flags or interactive prompts
  let config: InitConfig;

  if (nonInteractive) {
    config = {
      mode: modeFlag,
      vpn: vpnFlag,
      startDocker: !noDockerflag,
    };
  } else {
    const modeIdx = await select("Deployment mode", [
      { label: "Host", hint: "AI agent runs locally (Claude Code, Codex, etc.)" },
      { label: "Hosted", hint: "everything in Docker, web UI + SSH access" },
    ]);

    const vpnIdx = await select("VPN needed? (Hack The Box, TryHackMe, OffSec Proving Grounds)", [
      { label: "No", hint: "" },
      { label: "Yes", hint: "place .ovpn files in vpn/ after setup" },
    ]);

    const dockerIdx = await select("Start services now?", [
      { label: "Yes", hint: "" },
      { label: "No", hint: "start manually later with docker compose up -d" },
    ]);

    config = {
      mode: modeIdx === 0 ? "host" : "hosted",
      vpn: vpnIdx === 1,
      startDocker: dockerIdx === 0,
    };
  }

  // Create target directory
  if (targetDir !== "." && !existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
    ok(`Created ${targetDir}/`);
  }

  if (!checkCommand("docker")) {
    log(red("Docker is required. Install from https://docker.com"));
    process.exit(1);
  }

  console.log();
  log(bold("Scaffolding workspace..."));
  console.log();

  // Download files from repo
  const results = await Promise.all([
    download("docker-compose.yml", join(cwd, "docker-compose.yml"), "docker-compose.yml"),
    download(".env.example", join(cwd, ".env"), ".env"),
    download("AGENTS.md", join(cwd, "AGENTS.md"), "AGENTS.md"),
  ]);

  const hadFailure = results.some(r => r === "failed");

  // Symlink CLAUDE.md -> AGENTS.md (use lstatSync to detect broken symlinks)
  const claudePath = join(cwd, "CLAUDE.md");
  let claudeExists = false;
  try { lstatSync(claudePath); claudeExists = true; } catch {}
  if (!claudeExists) {
    symlinkSync("AGENTS.md", claudePath);
    ok("CLAUDE.md -> AGENTS.md");
  } else {
    skip("CLAUDE.md");
  }

  // .gitignore
  writeIfMissing(join(cwd, ".gitignore"), [
    ".env",
    "engagements/",
    "node_modules/",
    ".tool-log/",
    ".pk/",
    "",
  ].join("\n"), ".gitignore");

  // engagements/
  if (!existsSync(join(cwd, "engagements"))) {
    mkdirSync(join(cwd, "engagements"), { recursive: true });
    writeFileSync(join(cwd, "engagements", ".gitkeep"), "");
    ok("engagements/");
  } else {
    skip("engagements/");
  }

  // vpn/ (only when requested)
  if (config.vpn) {
    if (!existsSync(join(cwd, "vpn"))) {
      mkdirSync(join(cwd, "vpn"), { recursive: true });
      writeFileSync(join(cwd, "vpn", ".gitkeep"), "");
      writeFileSync(join(cwd, "vpn", "README.md"),
        "# VPN configs\n\nPlace your `.ovpn` files here. Then run `pk vpn up` to connect.\n");
      ok("vpn/");
    } else {
      skip("vpn/");
    }
  }

  console.log();

  // Start services
  if (hadFailure) {
    log(red("Some files failed to download. Fix the errors above, then run again."));
  } else if (config.startDocker) {
    log(bold("Starting services..."));
    console.log();

    const compose = checkCommand("docker-compose") ? "docker-compose" : "docker compose";
    const profiles: string[] = [];
    if (config.mode === "hosted") profiles.push("--profile", "hosted");
    if (config.vpn) profiles.push("--profile", "linux-vpn");

    const cmd = [compose, ...profiles, "up", "-d"].join(" ");
    log(dim(`$ ${cmd}`));

    try {
      execSync(cmd, { cwd, stdio: "inherit" });
      console.log();
      ok("Services running");
    } catch {
      console.log();
      log(red(`docker compose failed. Retry with: ${cmd}`));
    }
  } else {
    log(dim("Skipping docker compose (--no-docker)"));
  }

  // Next steps
  console.log();
  log(bold("PK is ready."));
  console.log();

  if (config.mode === "hosted") {
    log(`  Web UI:    ${cyan("http://localhost:3100")}`);
    log(`  SSH:       ${cyan("ssh -p 2222 root@localhost")}`);
    log(`  Terminal:  ${cyan("http://localhost:7681")}`);
    if (config.vpn) {
      console.log();
      log(`  VPN: place .ovpn files in vpn/ then run ${dim("pk vpn up")}`);
    }
    if (config.startDocker && !hadFailure) {
      console.log();
      log(dim("Opening http://localhost:3100..."));
      openBrowser("http://localhost:3100");
    }
  } else {
    log("  Open this directory in Claude Code, Codex, or your preferred agent.");
    log("  The agent reads AGENTS.md for instructions.");
    console.log();
    log("  Create your first engagement:");
    log(dim(`    pk engagement new --name "Target" --type ctf --scope "10.10.11.x"`));
    if (config.vpn) {
      console.log();
      log(`  VPN: place .ovpn files in vpn/ then run ${dim("pk vpn up")}`);
    }
  }
  console.log();
}

main().catch((err) => {
  log(red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
