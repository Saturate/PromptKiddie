#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile } from "node:child_process";
import { z } from "zod";
import { parseNmapXml } from "./parsers/nmap.js";
import { parseNucleiJsonl } from "./parsers/nuclei.js";

const CONTAINER = process.env.PK_TOOLING_CONTAINER ?? "promptkiddie-tooling";
const TIMEOUT = Number(process.env.PK_TOOLING_TIMEOUT ?? "300000");
const NET_PREFIX = "pk-eng-";

function hostExec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = execFile(cmd, args, { timeout: 30000 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
      });
    });
    proc.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 1 }));
  });
}

function dockerExec(cmd: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = execFile(
      "docker",
      ["exec", CONTAINER, ...cmd],
      { maxBuffer: 10 * 1024 * 1024, timeout: TIMEOUT },
      (err, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
        });
      },
    );
    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

function result(r: { stdout: string; stderr: string; code: number }) {
  const parts: string[] = [];
  if (r.stdout) parts.push(r.stdout);
  if (r.stderr) parts.push(`[stderr]\n${r.stderr}`);
  if (r.code !== 0) parts.push(`[exit code: ${r.code}]`);
  return {
    content: [{ type: "text" as const, text: parts.join("\n") || "(no output)" }],
  };
}

const server = new McpServer({
  name: "promptkiddie-tooling",
  version: "0.1.0",
});

// --- nmap ------------------------------------------------------------------

server.tool(
  "rustscan",
  "Fast port scanner. Finds open ports quickly, then optionally pipes to nmap for service detection.",
  {
    target: z.string().describe("Host, IP, or comma-separated list"),
    ports: z.string().optional().describe("Port range, e.g. '1-65535' (default: all)"),
    flags: z.string().optional().describe("Extra rustscan flags, e.g. '--ulimit 5000 -t 2000'"),
    nmapFlags: z.string().optional().describe("Flags to pass to nmap after port discovery, e.g. '-sV -sC'"),
  },
  async ({ target, ports, flags, nmapFlags }) => {
    const args = ["rustscan", "-a", target];
    if (ports) args.push("-p", ports);
    if (flags) args.push(...flags.split(/\s+/));
    if (nmapFlags) args.push("--", ...nmapFlags.split(/\s+/));
    return result(await dockerExec(args));
  },
);

server.tool(
  "nmap",
  "Port and service scanner. Returns structured JSON by default (parsed from XML). Set raw=true for plain text.",
  {
    target: z.string().describe("Host, IP, or CIDR range to scan"),
    flags: z.string().optional().describe("Extra nmap flags, e.g. '-sV -sC -p 1-1000'"),
    raw: z.boolean().optional().describe("Return raw text output instead of parsed JSON"),
  },
  async ({ target, flags, raw }) => {
    const args = ["nmap"];
    if (flags) args.push(...flags.split(/\s+/));
    if (!raw) args.push("-oX", "-");
    args.push(target);
    const r = await dockerExec(args);
    if (raw || r.code !== 0) return result(r);
    const parsed = parseNmapXml(r.stdout);
    return { content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }] };
  },
);

// --- ffuf ------------------------------------------------------------------

server.tool(
  "ffuf",
  "Web fuzzer for directories, vhosts, and parameters.",
  {
    url: z.string().describe("Target URL with FUZZ keyword, e.g. http://target/FUZZ"),
    wordlist: z.string().optional().describe("Wordlist path inside container (default: /usr/share/wordlists/dirb/common.txt)"),
    flags: z.string().optional().describe("Extra ffuf flags, e.g. '-mc 200,301 -t 50'"),
  },
  async ({ url, wordlist, flags }) => {
    const wl = wordlist ?? "/usr/share/wordlists/dirb/common.txt";
    const args = ["ffuf", "-u", url, "-w", wl, "-o", "/dev/stdout", "-of", "json"];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args));
  },
);

// --- nuclei ----------------------------------------------------------------

server.tool(
  "nuclei",
  "Vulnerability scanner using community templates. Returns structured findings JSON (parsed from JSONL). Set raw=true for plain text.",
  {
    target: z.string().describe("Target URL or host"),
    templates: z.string().optional().describe("Template tags or paths, e.g. '-tags cve,misconfig'"),
    flags: z.string().optional().describe("Extra nuclei flags"),
    raw: z.boolean().optional().describe("Return raw JSONL instead of parsed findings array"),
  },
  async ({ target, templates, flags, raw }) => {
    const args = ["nuclei", "-u", target, "-jsonl"];
    if (templates) args.push(...templates.split(/\s+/));
    if (flags) args.push(...flags.split(/\s+/));
    const r = await dockerExec(args);
    if (raw || r.code !== 0) return result(r);
    const findings = parseNucleiJsonl(r.stdout);
    return { content: [{ type: "text" as const, text: JSON.stringify(findings, null, 2) }] };
  },
);

// --- gobuster --------------------------------------------------------------

server.tool(
  "gobuster",
  "Directory and DNS brute-force scanner.",
  {
    mode: z.enum(["dir", "dns", "vhost", "fuzz"]).describe("Gobuster mode"),
    target: z.string().describe("Target URL (dir/vhost/fuzz) or domain (dns)"),
    wordlist: z.string().optional().describe("Wordlist path (default: /usr/share/wordlists/dirb/common.txt)"),
    flags: z.string().optional().describe("Extra gobuster flags"),
  },
  async ({ mode, target, wordlist, flags }) => {
    const wl = wordlist ?? "/usr/share/wordlists/dirb/common.txt";
    const args = ["gobuster", mode, "-u", target, "-w", wl];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args));
  },
);

// --- nikto -----------------------------------------------------------------

server.tool(
  "nikto",
  "Web server vulnerability scanner.",
  {
    target: z.string().describe("Target URL or host"),
    flags: z.string().optional().describe("Extra nikto flags, e.g. '-port 8080 -Tuning x'"),
  },
  async ({ target, flags }) => {
    const args = ["nikto", "-h", target, "-Format", "json", "-output", "/dev/stdout"];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args));
  },
);

// --- sqlmap ----------------------------------------------------------------

server.tool(
  "sqlmap",
  "SQL injection detection and exploitation.",
  {
    url: z.string().describe("Target URL with injectable parameter"),
    flags: z.string().optional().describe("Extra sqlmap flags, e.g. '--dbs --batch --level 3'"),
  },
  async ({ url, flags }) => {
    const args = ["sqlmap", "-u", url, "--batch"];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args));
  },
);

// --- httpx -----------------------------------------------------------------

server.tool(
  "httpx",
  "HTTP probe for live hosts, tech detection, and status codes.",
  {
    targets: z.string().describe("Comma-separated URLs or hosts, or a single target"),
    flags: z.string().optional().describe("Extra httpx flags, e.g. '-tech-detect -status-code -title'"),
  },
  async ({ targets, flags }) => {
    const args = ["sh", "-c", `echo '${targets.replace(/,/g, "\n")}' | httpx-toolkit -json ${flags ?? ""}`];
    return result(await dockerExec(args));
  },
);

// --- dig / whois / generic -------------------------------------------------

server.tool(
  "dig",
  "DNS lookup.",
  {
    domain: z.string().describe("Domain to query"),
    type: z.string().optional().describe("Record type (A, AAAA, MX, NS, TXT, ANY)"),
    flags: z.string().optional(),
  },
  async ({ domain, type, flags }) => {
    const args = ["dig"];
    if (flags) args.push(...flags.split(/\s+/));
    if (type) args.push(domain, type);
    else args.push(domain);
    return result(await dockerExec(args));
  },
);

server.tool(
  "whois",
  "WHOIS domain/IP lookup.",
  { target: z.string().describe("Domain or IP") },
  async ({ target }) => result(await dockerExec(["whois", target])),
);

server.tool(
  "tooling_exec",
  "Run an arbitrary command inside the tooling container. Use for tools not covered by dedicated commands.",
  {
    command: z.string().describe("Shell command to execute"),
  },
  async ({ command }) => result(await dockerExec(["sh", "-c", command])),
);

// --- Network isolation per engagement --------------------------------------

server.tool(
  "network_create",
  "Create an isolated Docker network for an engagement. The tooling container is connected to it.",
  {
    engagementSlug: z.string().describe("Engagement slug (used as network suffix)"),
    subnet: z.string().optional().describe("Optional subnet, e.g. '172.30.0.0/24'"),
  },
  async ({ engagementSlug, subnet }) => {
    const name = `${NET_PREFIX}${engagementSlug}`;
    const args = ["docker", "network", "create", "--driver", "bridge"];
    if (subnet) args.push("--subnet", subnet);
    args.push(name);
    const create = await hostExec(args[0], args.slice(1));
    if (create.code !== 0) return result(create);
    const connect = await hostExec("docker", ["network", "connect", name, CONTAINER]);
    if (connect.code !== 0) return result(connect);
    return { content: [{ type: "text" as const, text: JSON.stringify({ network: name, connected: true }) }] };
  },
);

server.tool(
  "network_destroy",
  "Disconnect the tooling container from an engagement network and remove it.",
  {
    engagementSlug: z.string().describe("Engagement slug"),
  },
  async ({ engagementSlug }) => {
    const name = `${NET_PREFIX}${engagementSlug}`;
    await hostExec("docker", ["network", "disconnect", name, CONTAINER]);
    const rm = await hostExec("docker", ["network", "rm", name]);
    return result(rm);
  },
);

server.tool(
  "network_list",
  "List all PromptKiddie engagement networks.",
  async () => {
    const r = await hostExec("docker", [
      "network", "ls", "--filter", `name=${NET_PREFIX}`, "--format", "{{json .}}",
    ]);
    if (r.code !== 0) return result(r);
    const networks = r.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    return { content: [{ type: "text" as const, text: JSON.stringify(networks, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
