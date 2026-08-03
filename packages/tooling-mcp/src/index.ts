#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { parseNmapXml } from "./parsers/nmap.js";
import { parseNucleiJsonl } from "./parsers/nuclei.js";

const DEFAULT_CONTAINER = process.env.PK_TOOLING_CONTAINER ?? "pk-worker";
const TIMEOUT = Number(process.env.PK_TOOLING_TIMEOUT ?? "300000");
const NET_PREFIX = "pk-eng-";
const LOG_DIR = process.env.PK_TOOL_LOG_DIR ?? "./engagements/.tool-log";

try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}

execFile("docker", ["inspect", "--format", "{{.State.Running}}", DEFAULT_CONTAINER], { timeout: 5000 }, (err, stdout) => {
  if (err || stdout.trim() !== "true") {
    console.error(`[pk-tooling] WARNING: container "${DEFAULT_CONTAINER}" not found or not running. All tool calls will fail. Set PK_TOOLING_CONTAINER to the active worker (e.g. pk-worker-<slug>) or start an engagement.`);
  } else {
    console.error(`[pk-tooling] container "${DEFAULT_CONTAINER}" is ready`);
  }
});

function logToolCall(tool: string, args: Record<string, unknown>, exitCode: number, durationMs: number) {
  const entry = {
    ts: new Date().toISOString(),
    tool,
    args,
    exitCode,
    durationMs,
  };
  try { appendFileSync(`${LOG_DIR}/tool-calls.jsonl`, JSON.stringify(entry) + "\n"); } catch {}
}

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

function dockerExec(cmd: string[], toolName?: string, container?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const target = container ?? DEFAULT_CONTAINER;
  const start = Date.now();
  const env = ["-e", "PK_EXEC=1"];
  return new Promise((resolve) => {
    const proc = execFile(
      "docker",
      ["exec", ...env, target, ...cmd],
      { maxBuffer: 10 * 1024 * 1024, timeout: TIMEOUT },
      (err, stdout, stderr) => {
        const r = {
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
        };
        if (toolName) logToolCall(toolName, { cmd, container: target }, r.code, Date.now() - start);
        resolve(r);
      },
    );
    proc.on("error", (err) => {
      if (toolName) logToolCall(toolName, { cmd, container: target }, 1, Date.now() - start);
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
  async ({ target, ports, flags, nmapFlags }: { target: string; ports?: string; flags?: string; nmapFlags?: string }) => {
    const args = ["rustscan", "-a", target];
    if (ports) args.push("-p", ports);
    if (flags) args.push(...flags.split(/\s+/));
    if (nmapFlags) args.push("--", ...nmapFlags.split(/\s+/));
    return result(await dockerExec(args, "rustscan"));
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
  async ({ target, flags, raw }: { target: string; flags?: string; raw?: boolean }) => {
    const args = ["nmap"];
    if (flags) args.push(...flags.split(/\s+/));
    if (!raw) args.push("-oX", "-");
    args.push(target);
    const r = await dockerExec(args, "nmap");
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
  async ({ url, wordlist, flags }: { url: string; wordlist?: string; flags?: string }) => {
    const wl = wordlist ?? "/usr/share/wordlists/dirb/common.txt";
    const args = ["ffuf", "-u", url, "-w", wl, "-o", "/dev/stdout", "-of", "json"];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args, "ffuf"));
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
  async ({ target, templates, flags, raw }: { target: string; templates?: string; flags?: string; raw?: boolean }) => {
    const args = ["nuclei", "-u", target, "-jsonl"];
    if (templates) args.push(...templates.split(/\s+/));
    if (flags) args.push(...flags.split(/\s+/));
    const r = await dockerExec(args, "nuclei");
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
  async ({ mode, target, wordlist, flags }: { mode: string; target: string; wordlist?: string; flags?: string }) => {
    const wl = wordlist ?? "/usr/share/wordlists/dirb/common.txt";
    const args = ["gobuster", mode, "-u", target, "-w", wl];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args, "gobuster"));
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
  async ({ target, flags }: { target: string; flags?: string }) => {
    const args = ["nikto", "-h", target, "-Format", "json", "-output", "/dev/stdout"];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args, "nikto"));
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
  async ({ url, flags }: { url: string; flags?: string }) => {
    const args = ["sqlmap", "-u", url, "--batch"];
    if (flags) args.push(...flags.split(/\s+/));
    return result(await dockerExec(args, "sqlmap"));
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
  async ({ targets, flags }: { targets: string; flags?: string }) => {
    const targetList = targets.split(",").map((t) => t.trim()).filter(Boolean);
    const printfArgs = targetList.map((t) => `printf '%s\\n' '${t.replace(/'/g, "'\\''")}'`).join("; ");
    const flagsArr = flags ? ` ${flags.replace(/[;|&$`]/g, "")}` : "";
    const args = ["sh", "-c", `(${printfArgs}) | httpx-toolkit -json${flagsArr}`];
    return result(await dockerExec(args, "httpx"));
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
  async ({ domain, type, flags }: { domain: string; type?: string; flags?: string }) => {
    const args = ["dig"];
    if (flags) args.push(...flags.split(/\s+/));
    if (type) args.push(domain, type);
    else args.push(domain);
    return result(await dockerExec(args, "dig"));
  },
);

server.tool(
  "whois",
  "WHOIS domain/IP lookup.",
  { target: z.string().describe("Domain or IP") },
  async ({ target }: { target: string }) => result(await dockerExec(["whois", target], "whois")),
);

server.tool(
  "tooling_exec",
  "Run an arbitrary command inside the toolbox container. Use for tools not covered by dedicated commands.",
  {
    command: z.string().describe("Shell command to execute"),
  },
  async ({ command }: { command: string }) => {
    return result(await dockerExec(["sh", "-c", command], "tooling_exec"));
  },
);

// --- Network isolation per engagement --------------------------------------

server.tool(
  "network_create",
  "Create an isolated Docker network for an engagement. The tooling container is connected to it.",
  {
    engagementSlug: z.string().describe("Engagement slug (used as network suffix)"),
    subnet: z.string().optional().describe("Optional subnet, e.g. '172.30.0.0/24'"),
  },
  async ({ engagementSlug, subnet }: { engagementSlug: string; subnet?: string }) => {
    const name = `${NET_PREFIX}${engagementSlug}`;
    const args = ["docker", "network", "create", "--driver", "bridge"];
    if (subnet) args.push("--subnet", subnet);
    args.push(name);
    const create = await hostExec(args[0], args.slice(1));
    if (create.code !== 0) return result(create);
    const connect = await hostExec("docker", ["network", "connect", name, DEFAULT_CONTAINER]);
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
  async ({ engagementSlug }: { engagementSlug: string }) => {
    const name = `${NET_PREFIX}${engagementSlug}`;
    await hostExec("docker", ["network", "disconnect", name, DEFAULT_CONTAINER]);
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

// --- Gleipnir (reverse shell relay) -----------------------------------------

const GLEIPNIR_URL = process.env.PK_GLEIPNIR_URL ?? "http://localhost:6666";
const GLEIPNIR_SOCK = process.env.PK_GLEIPNIR_SOCK ?? "/tmp/gleipnir.sock";

async function gleipnirHttpApi(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${GLEIPNIR_URL}${path}`, opts);
  const data = await resp.json() as Record<string, unknown>;
  if (!resp.ok) return { ok: false, error: (data as Record<string, string>).error ?? `HTTP ${resp.status}` };
  return { ok: true, data };
}

async function gleipnirSocketApi(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const client = net.createConnection(GLEIPNIR_SOCK, () => {
      client.write(JSON.stringify(request) + "\n");
    });
    let data = "";
    client.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    client.on("end", () => {
      try { resolve(JSON.parse(data.trim())); }
      catch { reject(new Error(`invalid response: ${data}`)); }
    });
    client.on("error", (err: Error) => {
      reject(new Error(`gleipnir relay not reachable: ${err.message}`));
    });
  });
}

async function gleipnirApi(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Try HTTP API first (v2), fall back to Unix socket (v1)
  const gleipnirUrl = process.env.PK_GLEIPNIR_URL ?? "http://localhost:6666";
  const actionMap: Record<string, { method: string; path: string }> = {
    sessions: { method: "GET", path: "/api/sessions" },
    session: { method: "GET", path: `/api/sessions/${request.name ?? request.session}` },
    exec: { method: "POST", path: `/api/sessions/${request.session}/exec` },
    upload: { method: "POST", path: `/api/sessions/${request.session}/upload` },
    download: { method: "POST", path: `/api/sessions/${request.session}/download` },
    socks: { method: "POST", path: "/api/tunnels" },
    tunnels: { method: "GET", path: "/api/tunnels" },
  };
  const action = request.action as string;
  const mapping = actionMap[action];
  if (mapping) {
    try {
      const res = await fetch(`${gleipnirUrl}${mapping.path}`, {
        method: mapping.method,
        headers: { "Content-Type": "application/json" },
        body: mapping.method === "GET" ? undefined : JSON.stringify(request),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      return { ok: true, data };
    } catch {
      // HTTP failed, fall through to socket
    }
  }
  try {
    return await gleipnirSocketApi(request);
  } catch {
    throw new Error("gleipnir not reachable via HTTP API or Unix socket");
  }
}

server.tool(
  "gleipnir_exec",
  "Execute a command on a target via a gleipnir reverse shell session. Use instead of tooling_exec when you have an active gleipnir session on the target.",
  {
    session: z.string().describe("Session name (from gleipnir_sessions)"),
    command: z.string().describe("Shell command to execute on the target"),
    timeout: z.number().optional().describe("Timeout in seconds (default 300)"),
  },
  async ({ session, command, timeout }: { session: string; command: string; timeout?: number }) => {
    try {
      const resp = await gleipnirHttpApi("POST", `/api/sessions/${encodeURIComponent(session)}/exec`, { command, timeout: timeout ?? 300 });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      const data = resp.data as Record<string, string>;
      return { content: [{ type: "text" as const, text: data.output ?? data.output_b64 ?? JSON.stringify(data) }] };
    } catch {
      const resp = await gleipnirApi({ action: "exec", session, command, timeout: timeout ?? 300 });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: (resp.data as Record<string, string>).output }] };
    }
  },
);

server.tool(
  "gleipnir_upload",
  "Upload a file to a target through a gleipnir session.",
  {
    session: z.string().describe("Session name"),
    src: z.string().describe("Local source file path (on the toolbox)"),
    dst: z.string().describe("Remote destination path (on the target)"),
  },
  async ({ session, src, dst }: { session: string; src: string; dst: string }) => {
    try {
      const resp = await gleipnirHttpApi("POST", `/api/sessions/${encodeURIComponent(session)}/upload`, { src_path: src, dst_path: dst });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Uploaded ${src} -> ${dst}` }] };
    } catch {
      const resp = await gleipnirApi({ action: "upload", session, src, dst });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `Uploaded ${src} -> ${dst}` }] };
    }
  },
);

server.tool(
  "gleipnir_download",
  "Download a file from a target through a gleipnir session.",
  {
    session: z.string().describe("Session name"),
    src: z.string().describe("Remote source file path (on the target)"),
    dst: z.string().describe("Local destination path (on the toolbox)"),
  },
  async ({ session, src, dst }: { session: string; src: string; dst: string }) => {
    try {
      const resp = await gleipnirHttpApi("POST", `/api/sessions/${encodeURIComponent(session)}/download`, { remote_path: src });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      const data = resp.data as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: `Downloaded ${src} (${data.size} bytes)` }] };
    } catch {
      const resp = await gleipnirApi({ action: "download", session, src, dst });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      const data = resp.data as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: `Downloaded ${src} -> ${dst} (${data.size} bytes)` }] };
    }
  },
);

server.tool(
  "gleipnir_sessions",
  "List active gleipnir reverse shell sessions.",
  async () => {
    try {
      const resp = await gleipnirHttpApi("GET", "/api/sessions");
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }] };
    } catch {
      const resp = await gleipnirApi({ action: "sessions" });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: JSON.stringify(resp.data, null, 2) }] };
    }
  },
);

server.tool(
  "gleipnir_tunnel",
  "Start or stop a SOCKS5 proxy tunnel through a gleipnir session.",
  {
    session: z.string().describe("Session name"),
    port: z.number().describe("Local SOCKS5 port (e.g. 1080)"),
    stop: z.boolean().optional().describe("Set true to stop the tunnel"),
  },
  async ({ session, port, stop }: { session: string; port: number; stop?: boolean }) => {
    try {
      if (stop) {
        const resp = await gleipnirHttpApi("DELETE", `/api/tunnels/${encodeURIComponent(session)}`);
        if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
        return { content: [{ type: "text" as const, text: `Tunnel stopped for '${session}'` }] };
      }
      const resp = await gleipnirHttpApi("POST", "/api/tunnels", { session, port });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      return { content: [{ type: "text" as const, text: `SOCKS5 proxy for '${session}' on 127.0.0.1:${port}` }] };
    } catch {
      const resp = await gleipnirApi({ action: "socks", session, port, stop: stop ?? false });
      if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
      const msg = stop ? `Tunnel stopped for '${session}'` : `SOCKS5 proxy for '${session}' on 127.0.0.1:${port}`;
      return { content: [{ type: "text" as const, text: msg }] };
    }
  },
);

server.tool(
  "gleipnir_listen",
  "Open a new gleipnir listener on a port. Mode can be 'agent' (native protocol), 'raw' (catch bash/netcat shells), or 'http' (poll-based C2).",
  {
    port: z.number().describe("Port to listen on (0 for auto-allocate)"),
    mode: z.enum(["agent", "raw", "http"]).optional().describe("Listener mode (default: raw)"),
  },
  async ({ port, mode }: { port: number; mode?: string }) => {
    const resp = await gleipnirHttpApi("POST", "/api/listeners", { port, mode: mode ?? "raw" });
    if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
    const data = resp.data as Record<string, unknown>;
    return { content: [{ type: "text" as const, text: `Listener ${data.id} started on port ${data.port} (${data.mode})` }] };
  },
);

server.tool(
  "gleipnir_kill",
  "Kill an active gleipnir session.",
  {
    session: z.string().describe("Session name to kill"),
  },
  async ({ session }: { session: string }) => {
    const resp = await gleipnirHttpApi("DELETE", `/api/sessions/${encodeURIComponent(session)}`);
    if (!resp.ok) return { content: [{ type: "text" as const, text: `Error: ${resp.error}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Session '${session}' killed` }] };
  },
);

// --- webshell ----------------------------------------------------------------

server.tool(
  "webshell_exec",
  "Execute a command through a webshell. Auto-logs the command. Use for target interaction when you have a PHP/ASPX/JSP webshell.",
  {
    url: z.string().describe("Full webshell URL, e.g. http://target/shell.php"),
    command: z.string().describe("Command to execute on the target"),
    param: z.string().optional().describe("POST parameter name for the command (default: cmd)"),
    method: z.enum(["GET", "POST"]).optional().describe("HTTP method (default: POST)"),
  },
  async ({ url, command, param, method }: { url: string; command: string; param?: string; method?: string }) => {
    const p = param ?? "cmd";
    const m = method ?? "POST";
    const curlArgs = m === "GET"
      ? ["curl", "-s", `${url}?${p}=${encodeURIComponent(command)}`]
      : ["curl", "-s", url, "--data-urlencode", `${p}=${command}`];
    return result(await dockerExec(curlArgs, "webshell"));
  },
);

// --- ws_shell (WebSocket terminal) ------------------------------------------

const WS_SHELL_PY = `
import socket, ssl, os, struct, base64, time, re, sys, json

args = json.loads(sys.argv[1])
url = args["url"]
command = args["command"]
timeout_ms = args.get("timeout", 5000)
init_wait_ms = args.get("initWait", 1000)

# Parse URL
import urllib.parse
parsed = urllib.parse.urlparse(url)
use_tls = parsed.scheme == "wss"
host = parsed.hostname
port = parsed.port or (443 if use_tls else 80)
path = parsed.path or "/"
if parsed.query:
    path += "?" + parsed.query

# Connect
sock = socket.create_connection((host, port), timeout=10)
if use_tls:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    sock = ctx.wrap_socket(sock, server_hostname=host)

# WebSocket handshake
key = base64.b64encode(os.urandom(16)).decode()
req = f"GET {path} HTTP/1.1\\r\\nHost: {host}\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: {key}\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n"
sock.sendall(req.encode())
resp = b""
while b"\\r\\n\\r\\n" not in resp:
    resp += sock.recv(4096)
status = resp.split(b"\\r\\n")[0].decode()
if b"101" not in resp.split(b"\\r\\n")[0]:
    print(f"WebSocket handshake failed: {status}", file=sys.stderr)
    sys.exit(1)

def ws_send(s, data):
    p = data.encode()
    m = os.urandom(4)
    ln = len(p)
    if ln < 126:
        f = bytearray([0x81, 0x80 | ln]) + m
    elif ln < 65536:
        f = bytearray([0x81, 0x80 | 126]) + struct.pack(">H", ln) + m
    else:
        f = bytearray([0x81, 0x80 | 127]) + struct.pack(">Q", ln) + m
    f.extend(bytearray(b ^ m[i % 4] for i, b in enumerate(p)))
    s.sendall(f)

def ws_recv(s, t):
    s.settimeout(t)
    out = b""
    try:
        while True:
            d = s.recv(65536)
            if not d:
                break
            out += d
    except (socket.timeout, ssl.SSLError):
        pass
    txt = ""
    i = 0
    while i < len(out):
        if i + 2 > len(out):
            break
        l = out[i + 1] & 0x7F
        o = i + 2
        if l == 126:
            if i + 4 > len(out): break
            l = struct.unpack(">H", out[i+2:i+4])[0]; o = i + 4
        elif l == 127:
            if i + 10 > len(out): break
            l = struct.unpack(">Q", out[i+2:i+10])[0]; o = i + 10
        if o + l > len(out):
            break
        txt += out[o:o+l].decode("utf-8", errors="replace")
        i = o + l
    return txt

# Wait for initial prompt
time.sleep(init_wait_ms / 1000.0)
ws_recv(sock, 0.5)

# Send command
ws_send(sock, command + "\\n")
time.sleep(timeout_ms / 1000.0)
output = ws_recv(sock, 1)

# Strip terminal escapes
output = re.sub(r"\\x1b\\[[^a-zA-Z]*[a-zA-Z]", "", output)
output = re.sub(r"\\x1b\\][^\\x07]*\\x07", "", output)
output = output.replace("\\r", "")

sock.close()
print(output.strip())
`;

server.tool(
  "ws_shell",
  "Connect to a WebSocket endpoint, send a command, and return the response. For interactive WebSocket shells (e.g., terminal endpoints, auth bypasses).",
  {
    url: z.string().describe("WebSocket URL, e.g. wss://host/terminal/ws"),
    command: z.string().describe("Command to send after connecting"),
    timeout: z.number().optional().describe("Milliseconds to wait for response (default: 5000)"),
    initWait: z.number().optional().describe("Milliseconds to wait after connect before sending (default: 1000)"),
  },
  async ({ url, command, timeout, initWait }: { url: string; command: string; timeout?: number; initWait?: number }) => {
    const args = JSON.stringify({ url, command, timeout: timeout ?? 5000, initWait: initWait ?? 1000 });
    return result(await dockerExec(["python3", "-c", WS_SHELL_PY, args], "ws_shell"));
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
