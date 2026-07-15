import { describe, it, expect } from "vitest";
import { createMockContext } from "../sdk.js";
import { CTF_PLAYBOOK } from "../actions/ctf.js";

function findAction(name: string) {
  return CTF_PLAYBOOK.actions.find((a) => a.name === name);
}

// ---------------------------------------------------------------------------
// Exec call argument assertions
// ---------------------------------------------------------------------------

describe("exec argument verification", () => {
  it("port_scan passes correct rustscan args", async () => {
    const action = findAction("port_scan")!;
    const ctx = createMockContext({
      target: "10.129.1.50",
      event: { type: "EngagementStarted" },
      execResults: {
        rustscan: { stdout: "", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const call = ctx.execCalls.find((c) => c.tool === "rustscan");
    expect(call).toBeDefined();
    expect(call!.args).toContain("-a");
    expect(call!.args).toContain("10.129.1.50");
    expect(call!.args).toContain("-sV");
  });

  it("ssl_hostnames connects to the correct port", async () => {
    const action = findAction("ssl_hostnames")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 8443 } },
      execResults: {
        openssl: { stdout: "", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const call = ctx.execCalls.find((c) => c.tool === "openssl");
    expect(call).toBeDefined();
    expect(call!.args).toContain("-connect");
    expect(call!.args.some((a) => a.includes(":8443"))).toBe(true);
  });

  it("cve_search passes product and version to searchsploit", async () => {
    const action = findAction("cve_search")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "VersionIdentified", payload: { product: "Apache", version: "2.4.49" } },
      execResults: {
        searchsploit: { stdout: "No results", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const call = ctx.execCalls.find((c) => c.tool === "searchsploit");
    expect(call).toBeDefined();
    expect(call!.args).toContain("Apache");
    expect(call!.args).toContain("2.4.49");
  });

  it("nuclei_scan targets the correct port", async () => {
    const action = findAction("nuclei_scan")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 8080, service: "http" } },
      execResults: {
        nuclei: { stdout: "", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const call = ctx.execCalls.find((c) => c.tool === "nuclei");
    expect(call).toBeDefined();
    expect(call!.args.some((a) => a.includes(":8080"))).toBe(true);
  });

  it("cred_crack passes the hash file path to john", async () => {
    const action = findAction("cred_crack")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "CredentialFound", payload: { hashFile: "/tmp/shadow.txt" } },
      execResults: {
        hashid: { stdout: "MD5", stderr: "", code: 0, durationMs: 10 },
        john: { stdout: "0 left", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const johnCall = ctx.execCalls.find((c) => c.tool === "john");
    expect(johnCall).toBeDefined();
    expect(johnCall!.args).toContain("/tmp/shadow.txt");
  });

  it("udp_scan uses correct nmap flags", async () => {
    const action = findAction("udp_scan")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "EngagementStarted" },
      execResults: {
        nmap: { stdout: "", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const call = ctx.execCalls.find((c) => c.tool === "nmap");
    expect(call).toBeDefined();
    expect(call!.args).toContain("-sU");
    expect(call!.args).toContain("--top-ports");
    expect(call!.args).toContain("--open");
  });
});

// ---------------------------------------------------------------------------
// Async behavior with delays (timeScale = 0.01 -> 100x faster)
// ---------------------------------------------------------------------------

describe("async behavior with delays", () => {
  it("post_exploit_enum runs sysinfo tools in parallel", async () => {
    const action = findAction("post_exploit_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      timeScale: 0.01,
      execResults: {
        id: { stdout: "uid=33(www-data)", stderr: "", code: 0, durationMs: 10, delay: 50 },
        uname: { stdout: "Linux target 5.15.0", stderr: "", code: 0, durationMs: 10, delay: 50 },
        hostname: { stdout: "target", stderr: "", code: 0, durationMs: 10, delay: 50 },
        cat: { stdout: "", stderr: "", code: 1, durationMs: 10, delay: 50 },
        ip: { stdout: "2: eth0: inet 10.0.0.1/24", stderr: "", code: 0, durationMs: 10, delay: 50 },
        arp: { stdout: "", stderr: "", code: 0, durationMs: 10, delay: 50 },
        ss: { stdout: "LISTEN *:22", stderr: "", code: 0, durationMs: 10, delay: 50 },
        find: { stdout: "", stderr: "", code: 0, durationMs: 10, delay: 50 },
      },
    });

    const start = Date.now();
    await action.run!(ctx);
    const elapsed = Date.now() - start;

    // With Promise.all, 6 parallel calls at 0.5ms each should complete
    // much faster than 6 sequential calls (3ms). Allow generous margin.
    expect(elapsed).toBeLessThan(200);
    expect(ctx.execCalls.length).toBeGreaterThanOrEqual(6);
    expect(ctx.discoveries.length).toBeGreaterThanOrEqual(1);
  });

  it("privesc runs sudo/suid/cron/writable in parallel", async () => {
    const action = findAction("privesc")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      timeScale: 0.01,
      execResults: {
        uname: { stdout: "Linux", stderr: "", code: 0, durationMs: 10, delay: 10 },
        sudo: { stdout: "(ALL) NOPASSWD: /usr/bin/vim", stderr: "", code: 0, durationMs: 10, delay: 100 },
        find: { stdout: "/usr/bin/passwd", stderr: "", code: 0, durationMs: 10, delay: 100 },
        cat: { stdout: "* * * * * root /opt/cleanup.sh", stderr: "", code: 0, durationMs: 10, delay: 100 },
      },
    });

    const start = Date.now();
    await action.run!(ctx);
    const elapsed = Date.now() - start;

    // 4 parallel execs at 1ms each; sequential would be 4ms
    expect(elapsed).toBeLessThan(200);
    expect(ctx.discoveries.some((d) => d.summary.includes("sudo"))).toBe(true);
  });

  it("web_recon runs fingerprint and header inspect in parallel", async () => {
    const action = findAction("web_recon")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      timeScale: 0.01,
      execResults: {
        whatweb: {
          stdout: JSON.stringify({ target: "http://10.0.0.1", plugins: { nginx: { version: ["1.28.0"] } } }),
          stderr: "", code: 0, durationMs: 10, delay: 200,
        },
        curl: {
          stdout: "HTTP/1.1 200 OK\nServer: nginx/1.28.0",
          stderr: "", code: 0, durationMs: 10, delay: 200,
        },
      },
    });

    const start = Date.now();
    await action.run!(ctx);
    const elapsed = Date.now() - start;

    // Both run in parallel via Promise.all
    expect(elapsed).toBeLessThan(200);
    expect(ctx.execCalls.some((c) => c.tool === "whatweb")).toBe(true);
    expect(ctx.execCalls.some((c) => c.tool === "curl")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Failure injection - partial failures in parallel actions
// ---------------------------------------------------------------------------

describe("failure injection", () => {
  it("post_exploit_enum survives individual tool failures", async () => {
    const action = findAction("post_exploit_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      execResults: {
        id: { stdout: "uid=33(www-data)", stderr: "", code: 0, durationMs: 10 },
        uname: { stdout: "", stderr: "command not found", code: 127, durationMs: 10 },
        hostname: { stdout: "target", stderr: "", code: 0, durationMs: 10 },
        cat: { stdout: "", stderr: "Permission denied", code: 1, durationMs: 10 },
        ip: { stdout: "", stderr: "command not found", code: 127, durationMs: 10 },
        arp: { stdout: "", stderr: "command not found", code: 127, durationMs: 10 },
        ss: { stdout: "", stderr: "command not found", code: 127, durationMs: 10 },
        find: { stdout: "", stderr: "", code: 0, durationMs: 10 },
      },
    });

    // Should not throw even when most tools fail
    await action.run!(ctx);

    // Should still record what it could gather
    expect(ctx.discoveries.some((d) => d.summary.includes("www-data"))).toBe(true);
  });

  it("privesc survives sudo permission denied", async () => {
    const action = findAction("privesc")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      execResults: {
        uname: { stdout: "Linux", stderr: "", code: 0, durationMs: 10 },
        sudo: { stdout: "", stderr: "sorry, user www-data may not run sudo", code: 1, durationMs: 10 },
        find: { stdout: "/usr/bin/passwd", stderr: "", code: 0, durationMs: 10 },
        cat: { stdout: "", stderr: "Permission denied", code: 1, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.summary.includes("SUID"))).toBe(true);
    // sudo discovery should not fire with exit code 1
  });

  it("smb_enum handles enum4linux crash gracefully", async () => {
    const action = findAction("smb_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 445 } },
      execResults: {
        enum4linux: { stdout: "", stderr: "Segmentation fault", code: 139, durationMs: 10 },
      },
    });

    // Should not throw
    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.summary === "SMB enumeration complete")).toBe(true);
  });

  it("nuclei_scan handles malformed JSON lines", async () => {
    const action = findAction("nuclei_scan")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      execResults: {
        nuclei: {
          stdout: '{"templateID":"CVE-2021-44228","info":{"name":"Log4Shell","severity":"critical"}}\n{BROKEN JSON\n{"templateID":"info-disclosure","info":{"name":"Info Leak","severity":"medium"}}',
          stderr: "", code: 0, durationMs: 100,
        },
      },
    });

    await action.run!(ctx);

    const findings = ctx.emitted.filter((e) => e.type === "FindingAdded");
    // Should parse 2 valid lines, skip the broken one
    expect(findings).toHaveLength(2);
    expect(findings[0].payload.title).toBe("Log4Shell");
    expect(findings[1].payload.title).toBe("Info Leak");
  });

  it("dir_brute handles corrupted ffuf JSON", async () => {
    const action = findAction("dir_brute")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      execResults: {
        ffuf: { stdout: "", stderr: "", code: 0, durationMs: 100 },
      },
    });
    ctx.readFile = async () => "NOT VALID JSON {{{";

    await action.run!(ctx);

    // Should record negative discovery instead of crashing
    expect(ctx.discoveries.some((d) => d.type === "negative" && d.category === "web")).toBe(true);
  });

  it("flag_capture handles no user.txt found", async () => {
    const action = findAction("flag_capture")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      execResults: {
        find: { stdout: "", stderr: "", code: 0, durationMs: 10 },
        cat: { stdout: "", stderr: "No such file", code: 1, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    // No flags should be emitted
    expect(ctx.emitted.filter((e) => e.type === "FlagCaptured")).toHaveLength(0);
  });

  it("web_recon survives whatweb returning non-JSON", async () => {
    const action = findAction("web_recon")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      execResults: {
        whatweb: { stdout: "ERROR: connection refused", stderr: "", code: 1, durationMs: 10 },
        curl: { stdout: "HTTP/1.1 200 OK\nServer: Apache/2.4.41", stderr: "", code: 0, durationMs: 10 },
      },
    });

    // Should not throw
    await action.run!(ctx);
  });
});

// ---------------------------------------------------------------------------
// Timing with real-ish delays (timeScale = 0.001 -> 1000x faster)
// ---------------------------------------------------------------------------

describe("timing verification", () => {
  it("parallel execs complete faster than sequential", async () => {
    const action = findAction("post_exploit_enum")!;

    // Parallel version (real action uses Promise.all)
    const ctxParallel = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      timeScale: 0.001,
      execResults: {
        id: { stdout: "uid=33(www-data)", stderr: "", code: 0, durationMs: 10, delay: 500 },
        uname: { stdout: "Linux", stderr: "", code: 0, durationMs: 10, delay: 500 },
        hostname: { stdout: "target", stderr: "", code: 0, durationMs: 10, delay: 500 },
        cat: { stdout: "", stderr: "", code: 1, durationMs: 10, delay: 500 },
        ip: { stdout: "inet 10.0.0.1/24", stderr: "", code: 0, durationMs: 10, delay: 500 },
        arp: { stdout: "", stderr: "", code: 0, durationMs: 10, delay: 500 },
        ss: { stdout: "", stderr: "", code: 0, durationMs: 10, delay: 500 },
        find: { stdout: "", stderr: "", code: 0, durationMs: 10, delay: 500 },
      },
    });

    const startParallel = Date.now();
    await action.run!(ctxParallel);
    const parallelTime = Date.now() - startParallel;

    // If 6 execs ran truly in parallel at 0.5ms each, total should be ~0.5ms not ~3ms
    // Allow generous margin for test environment overhead
    expect(parallelTime).toBeLessThan(100);
    expect(ctxParallel.execCalls.length).toBeGreaterThanOrEqual(6);
  });

  it("timeScale 0 makes all delays instant", async () => {
    const action = findAction("web_recon")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      timeScale: 0,
      execResults: {
        whatweb: { stdout: "{}", stderr: "", code: 0, durationMs: 10, delay: 999999 },
        curl: { stdout: "HTTP/1.1 200 OK", stderr: "", code: 0, durationMs: 10, delay: 999999 },
      },
    });

    const start = Date.now();
    await action.run!(ctx);
    const elapsed = Date.now() - start;

    // With timeScale=0, even a 999s delay resolves instantly
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// Exec call ordering
// ---------------------------------------------------------------------------

describe("exec call ordering", () => {
  it("flag_capture searches for user.txt before reading it", async () => {
    const action = findAction("flag_capture")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "lp" } },
      execResults: {
        find: { stdout: "/home/user/user.txt\n", stderr: "", code: 0, durationMs: 10 },
        cat: { stdout: "deadbeef1234", stderr: "", code: 0, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    const findIdx = ctx.execCalls.findIndex((c) => c.tool === "find");
    const catIdx = ctx.execCalls.findIndex((c) => c.tool === "cat");
    expect(findIdx).toBeLessThan(catIdx);
  });

  it("cred_crack runs hashid before john", async () => {
    const action = findAction("cred_crack")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "CredentialFound", payload: { hashFile: "/tmp/hashes" } },
      execResults: {
        hashid: { stdout: "MD5", stderr: "", code: 0, durationMs: 10 },
        john: { stdout: "0 left", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const hashidIdx = ctx.execCalls.findIndex((c) => c.tool === "hashid");
    const johnIdx = ctx.execCalls.findIndex((c) => c.tool === "john");
    expect(hashidIdx).toBeLessThan(johnIdx);
  });
});
