/**
 * `pk init` - scaffold a PromptKiddie workspace in the current directory.
 * Creates config, docker-compose, harness-specific agent/skill files, and
 * optionally starts services.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";

type Harness = "claude-code" | "opencode" | "pi";

interface InitOptions {
  harness?: string;
  dbUrl?: string;
  apiSecret?: string;
  skipDocker?: boolean;
  yes?: boolean;
}

function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const prompt = fallback ? `${question} [${fallback}]: ` : `${question}: `;
  return new Promise((res) => {
    rl.question(prompt, (answer) => {
      rl.close();
      res(answer.trim() || fallback || "");
    });
  });
}

async function pickHarness(flag?: string): Promise<Harness> {
  if (flag) return flag as Harness;
  console.error("\nWhich AI harness are you using?");
  console.error("  1) claude-code  (Claude Code CLI / Desktop)");
  console.error("  2) opencode     (OpenCode CLI)");
  console.error("  3) pi           (Pi.dev)");
  const choice = await ask("Choice", "1");
  const map: Record<string, Harness> = { "1": "claude-code", "2": "opencode", "3": "pi" };
  return map[choice] ?? "claude-code";
}

function writeIfMissing(path: string, content: string, label: string): boolean {
  if (existsSync(path)) {
    console.error(`  skip ${label} (already exists)`);
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.error(`  create ${label}`);
  return true;
}

function findTemplateDir(): string {
  let dir = resolve(dirname(new URL(import.meta.url).pathname));
  while (dir !== "/") {
    const candidate = join(dir, "templates");
    if (existsSync(candidate)) return candidate;
    const pkgCandidate = join(dir, "packages", "cli", "templates");
    if (existsSync(pkgCandidate)) return pkgCandidate;
    dir = dirname(dir);
  }
  throw new Error("Cannot find templates directory. Are you running from the pk source tree?");
}

function copyTemplate(templateDir: string, src: string, dest: string, label: string): boolean {
  const srcPath = join(templateDir, src);
  if (!existsSync(srcPath)) {
    console.error(`  skip ${label} (template not found: ${src})`);
    return false;
  }
  return writeIfMissing(dest, readFileSync(srcPath, "utf-8"), label);
}

export async function runInit(options: InitOptions) {
  const cwd = process.cwd();
  console.error("pk init: scaffolding workspace in " + cwd);

  const harness = await pickHarness(options.harness);
  console.error(`\nHarness: ${harness}`);

  const dbUrl = options.dbUrl ?? (options.yes
    ? "postgres://promptkiddie:changeme_local_only@localhost:5432/promptkiddie"
    : await ask("Database URL", "postgres://promptkiddie:changeme_local_only@localhost:5432/promptkiddie"));

  const apiSecret = options.apiSecret ?? (options.yes ? "" : await ask("API secret (leave empty to skip)", ""));

  let templateDir: string;
  try {
    templateDir = findTemplateDir();
  } catch {
    console.error("Warning: templates directory not found, generating inline config only.");
    templateDir = "";
  }

  console.error("\nScaffolding files...");

  // .env
  writeIfMissing(join(cwd, ".env"), [
    "# PromptKiddie environment",
    `DATABASE_URL=${dbUrl}`,
    "POSTGRES_USER=promptkiddie",
    "POSTGRES_PASSWORD=changeme_local_only",
    "POSTGRES_DB=promptkiddie",
    apiSecret ? `PK_API_SECRET=${apiSecret}` : "# PK_API_SECRET=your-secret-here",
    "",
  ].join("\n"), ".env");

  // .pk/config.toml
  writeIfMissing(join(cwd, ".pk", "config.toml"), [
    "[database]",
    `url = "${dbUrl}"`,
    "",
    "[attackbox]",
    'container = "promptkiddie-attackbox"',
    "timeout = 300000",
    'exec_mode = "docker"',
    "",
    "[vpn]",
    'config_path = "./vpn"',
    "",
    "[api]",
    "port = 3200",
    apiSecret ? `secret = "${apiSecret}"` : '# secret = "your-secret-here"',
    "",
  ].join("\n"), ".pk/config.toml");

  // docker-compose.yml
  if (templateDir) {
    copyTemplate(templateDir, "common/docker-compose.yml", join(cwd, "docker-compose.yml"), "docker-compose.yml");
  }

  // vpn directory
  if (!existsSync(join(cwd, "vpn"))) {
    mkdirSync(join(cwd, "vpn"), { recursive: true });
    writeIfMissing(join(cwd, "vpn", ".gitkeep"), "", "vpn/.gitkeep");
  }

  // engagements directory
  if (!existsSync(join(cwd, "engagements"))) {
    mkdirSync(join(cwd, "engagements"), { recursive: true });
    writeIfMissing(join(cwd, "engagements", ".gitkeep"), "", "engagements/.gitkeep");
  }

  // .gitignore additions
  const gitignorePath = join(cwd, ".gitignore");
  const gitignoreEntries = ["engagements/*/", ".env", ".pk/config.toml", "vpn/*.ovpn"];
  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, "utf-8");
    const missing = gitignoreEntries.filter((e) => !existing.includes(e));
    if (missing.length > 0) {
      writeFileSync(gitignorePath, existing.trimEnd() + "\n\n# PromptKiddie\n" + missing.join("\n") + "\n");
      console.error("  update .gitignore");
    }
  } else {
    writeIfMissing(gitignorePath, "# PromptKiddie\n" + gitignoreEntries.join("\n") + "\n", ".gitignore");
  }

  // Harness-specific files
  console.error(`\nScaffolding ${harness} harness files...`);

  if (harness === "claude-code") {
    if (templateDir) {
      copyTemplate(templateDir, "claude-code/CLAUDE.md", join(cwd, "CLAUDE.md"), "CLAUDE.md");
      for (const agent of ["recon-agent.md", "enum-agent.md", "exploit-agent.md", "report-agent.md"]) {
        copyTemplate(templateDir, `claude-code/agents/${agent}`, join(cwd, ".claude", "agents", agent), `.claude/agents/${agent}`);
      }
    } else {
      console.error("  skip harness files (no templates found)");
    }

    // Engagement hooks (gitignored, only active when pk init has been run)
    const localSettings = {
      hooks: {
        SessionStart: [{
          hooks: [{ type: "command", command: "bash .claude/hooks/session-start.sh" }],
        }],
        PreToolUse: [{
          hooks: [{ type: "command", command: "bash .claude/hooks/pk-exec-check.sh" }],
        }],
      },
    };
    writeIfMissing(
      join(cwd, ".claude", "settings.local.json"),
      JSON.stringify(localSettings, null, 2) + "\n",
      ".claude/settings.local.json (engagement hooks)",
    );
  } else if (harness === "opencode" || harness === "pi") {
    console.error(`  ${harness} harness templates not yet available. Created config only.`);
    console.error("  Contribute templates at github.com/Saturate/PromptKiddie");
  }

  // Start services
  if (!options.skipDocker) {
    const startDocker = options.yes || (await ask("\nStart Docker services? (y/n)", "y")).toLowerCase() === "y";
    if (startDocker) {
      console.error("\nStarting services...");
      try {
        execSync("docker compose up -d", { stdio: "inherit", cwd });
        console.error("Waiting for database...");
        execSync("sleep 3", { stdio: "inherit" });
      } catch {
        console.error("Warning: docker compose failed. Start manually with: docker compose up -d");
      }
    }
  }

  console.error("\nDone. Next steps:");
  console.error("  1. Place your .ovpn config in vpn/ (for THM/HTB)");
  console.error("  2. Run: pk vpn up");
  console.error("  3. Create an engagement: pk engagement new --name 'My CTF' --type ctf");
  console.error("  4. Start hacking.");
}
