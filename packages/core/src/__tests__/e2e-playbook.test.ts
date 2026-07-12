import { describe, it, expect } from "vitest";
import { createMockContext, type EngagementEvent, type MockContext } from "../sdk.js";
import { CTF_PLAYBOOK } from "../actions/ctf.js";

const RUSTSCAN_OUTPUT = `
Open 10.129.45.196:22
Open 10.129.45.196:80
Open 10.129.45.196:1515
PORT     STATE SERVICE     VERSION
22/tcp   open  ssh         OpenSSH 10.0p2 Ubuntu 5ubuntu5.4
80/tcp   open  http        nginx 1.28.0
1515/tcp open  unknown
`.trim();

const WHATWEB_OUTPUT = JSON.stringify({
  target: "http://10.129.45.196",
  plugins: {
    nginx: { version: ["1.28.0"] },
    HTTPServer: { string: ["nginx/1.28.0"] },
  },
});

const CURL_HEADERS = `HTTP/1.1 301 Moved Permanently
Location: http://paperwork.htb/
Server: nginx/1.28.0`;

const FFUF_OUTPUT = JSON.stringify({
  results: [
    { url: "http://paperwork.htb/download", status: 200, length: 1234 },
    { url: "http://paperwork.htb/static", status: 301, length: 0 },
  ],
});

const SERVER_PY = `import subprocess
class LpdHandler:
    def handle_print_job(self):
        job_name = line[1:]
        subprocess.Popen(f"echo 'Archive: {job_name}'", shell=True)
`;

const SEARCHSPLOIT_EMPTY = "Exploits: No results\nShellcodes: No results";

function makeEvent(type: string, payload: Record<string, unknown> = {}): EngagementEvent {
  return { id: `e-${Date.now()}-${Math.random()}`, type, payload, source: "test", engagementId: "test", createdAt: new Date() };
}

function findAction(name: string) {
  return CTF_PLAYBOOK.actions.find((a) => a.name === name);
}

describe("E2E: CTF playbook with mocked tool output", () => {
  it("port_scan parses rustscan output and emits PortDiscovered events", async () => {
    const action = findAction("port_scan")!;
    const ctx = createMockContext({
      target: "10.129.45.196",
      event: { type: "EngagementStarted" },
      execResults: {
        rustscan: { stdout: RUSTSCAN_OUTPUT, stderr: "", code: 0, durationMs: 14000 },
      },
    });

    await action.run!(ctx);

    const ports = ctx.emitted.filter((e) => e.type === "PortDiscovered");
    expect(ports).toHaveLength(3);
    expect(ports.map((p) => p.payload.port)).toEqual([22, 80, 1515]);
    expect(ports.find((p) => p.payload.port === 80)?.payload.service).toBe("http");
    expect(ports.find((p) => p.payload.port === 22)?.payload.service).toBe("ssh");
  });

  it("web_recon runs whatweb and extracts versions", async () => {
    const action = findAction("web_recon")!;
    const ctx = createMockContext({
      target: "10.129.45.196",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      execResults: {
        whatweb: { stdout: WHATWEB_OUTPUT, stderr: "", code: 0, durationMs: 3000 },
        curl: { stdout: CURL_HEADERS, stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const versions = ctx.emitted.filter((e) => e.type === "VersionIdentified");
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions.some((v) => v.payload.product === "nginx")).toBe(true);

    const hostnames = ctx.emitted.filter((e) => e.type === "HostnameFound");
    expect(hostnames.some((h) => h.payload.hostname === "paperwork.htb")).toBe(true);
  });

  it("dir_brute parses ffuf output and emits PathDiscovered", async () => {
    const action = findAction("dir_brute")!;
    const ctx = createMockContext({
      target: "10.129.45.196",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      execResults: {
        ffuf: { stdout: "", stderr: "", code: 0, durationMs: 68000 },
      },
    });
    // Mock the readFile for ffuf JSON output
    ctx.readFile = async () => FFUF_OUTPUT;

    await action.run!(ctx);

    const paths = ctx.emitted.filter((e) => e.type === "PathDiscovered");
    expect(paths).toHaveLength(2);
    expect(paths[0].payload.url).toBe("http://paperwork.htb/download");
  });

  it("source_code_analysis greps for dangerous patterns and deprioritizes dir_brute", async () => {
    const action = findAction("source_code_analysis")!;
    const ctx = createMockContext({
      target: "10.129.45.196",
      event: { type: "FileDownloaded", payload: { path: "recon/server.py", type: "python" } },
      execResults: {
        grep: { stdout: "65:        subprocess.Popen(f\"echo 'Archive: {job_name}'\", shell=True)", stderr: "", code: 0, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    expect(ctx.reprioritized.some((r) => r.name === "dir_brute" && r.priority === 80)).toBe(true);
  });

  it("source_code_analysis has a prompt field for LLM analysis (handled by supervisor)", () => {
    const action = findAction("source_code_analysis")!;
    expect(action.prompt).toBeDefined();
    expect(action.prompt).toContain("{path}");
    expect(action.prompt).toContain("injection");
  });

  it("cve_search runs searchsploit and records negative discovery when no hits", async () => {
    const action = findAction("cve_search")!;
    const ctx = createMockContext({
      target: "10.129.45.196",
      event: { type: "VersionIdentified", payload: { product: "nginx", version: "1.28.0" } },
      execResults: {
        searchsploit: { stdout: SEARCHSPLOIT_EMPTY, stderr: "", code: 0, durationMs: 200 },
      },
    });

    await action.run!(ctx);

    const negatives = ctx.discoveries.filter((d) => d.type === "negative" && d.category === "cve");
    expect(negatives).toHaveLength(1);
    expect(negatives[0].summary).toContain("nginx 1.28.0");
    expect(ctx.emitted.filter((e) => e.type === "ExploitAvailable")).toHaveLength(0);
  });

  it("cve_search has a prompt field for LLM fallback (handled by supervisor)", () => {
    const action = findAction("cve_search")!;
    expect(action.prompt).toBeDefined();
    expect(action.prompt).toContain("{product}");
    expect(action.prompt).toContain("{version}");
  });

  it("flag_capture reads user.txt and root.txt", async () => {
    const action = findAction("flag_capture")!;
    const ctx = createMockContext({
      target: "10.129.45.196",
      event: { type: "ShellObtained", payload: { user: "lp", method: "command_injection" } },
      execResults: {
        find: { stdout: "/home/archivist/user.txt\n", stderr: "", code: 0, durationMs: 500 },
        cat: { stdout: "03b8fd38f8a282131caaf36a891fa96d", stderr: "", code: 0, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    const flags = ctx.emitted.filter((e) => e.type === "FlagCaptured");
    expect(flags.length).toBeGreaterThanOrEqual(1);
    expect(flags[0].payload.value).toBe("03b8fd38f8a282131caaf36a891fa96d");
    expect(flags[0].payload.type).toBe("user");
  });

  it("full cascade: EngagementStarted -> port_scan -> web_recon -> cve_search", async () => {
    const actions = CTF_PLAYBOOK.actions;
    const allEmitted: Array<{ type: string; payload: Record<string, unknown> }> = [];

    async function runCascade(event: EngagementEvent, depth = 0) {
      if (depth > 5) return;
      const triggered = actions.filter((a) => {
        try { return a.on(event); } catch { return false; }
      });

      for (const action of triggered) {
        if (!action.run) continue;
        const ctx = createMockContext({
          target: "10.129.45.196",
          event: { type: event.type, payload: event.payload },
          execResults: {
            rustscan: { stdout: RUSTSCAN_OUTPUT, stderr: "", code: 0, durationMs: 14000 },
            whatweb: { stdout: WHATWEB_OUTPUT, stderr: "", code: 0, durationMs: 3000 },
            curl: { stdout: CURL_HEADERS, stderr: "", code: 0, durationMs: 100 },
            searchsploit: { stdout: SEARCHSPLOIT_EMPTY, stderr: "", code: 0, durationMs: 200 },
            nmap: { stdout: "", stderr: "", code: 0, durationMs: 5000 },
            ffuf: { stdout: "", stderr: "", code: 0, durationMs: 1000 },
            openssl: { stdout: "", stderr: "", code: 0, durationMs: 100 },
            grep: { stdout: "", stderr: "", code: 1, durationMs: 10 },
            enum4linux: { stdout: "", stderr: "", code: 0, durationMs: 5000 },
            snmpwalk: { stdout: "", stderr: "", code: 1, durationMs: 1000 },
            nuclei: { stdout: "", stderr: "", code: 0, durationMs: 10000 },
          },
        });
        ctx.readFile = async () => "{}";

        await action.run(ctx);

        for (const emitted of ctx.emitted) {
          allEmitted.push(emitted);
          await runCascade(makeEvent(emitted.type, emitted.payload), depth + 1);
        }
      }
    }

    await runCascade(makeEvent("EngagementStarted"));

    const types = [...new Set(allEmitted.map((e) => e.type))];
    expect(types).toContain("PortDiscovered");
    expect(types).toContain("VersionIdentified");
    expect(types).toContain("HostnameFound");

    const portEvents = allEmitted.filter((e) => e.type === "PortDiscovered");
    expect(portEvents.length).toBeGreaterThanOrEqual(3);

    const versionEvents = allEmitted.filter((e) => e.type === "VersionIdentified");
    expect(versionEvents.length).toBeGreaterThanOrEqual(1);
  });
});
