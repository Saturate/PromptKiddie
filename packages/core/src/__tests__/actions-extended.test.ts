import { describe, it, expect } from "vitest";
import { createMockContext } from "../sdk.js";
import { CTF_PLAYBOOK } from "../actions/ctf.js";

function findAction(name: string) {
  return CTF_PLAYBOOK.actions.find((a) => a.name === name);
}

// ---------------------------------------------------------------------------
// Trigger predicate tests
// ---------------------------------------------------------------------------

describe("Action trigger predicates", () => {
  const event = (type: string, payload: Record<string, unknown> = {}) => ({
    id: "t", type, payload, source: "test", engagementId: "t", createdAt: new Date(),
  });

  it("ssl_hostnames triggers on HTTPS ports", () => {
    const action = findAction("ssl_hostnames")!;
    expect(action.on(event("PortDiscovered", { port: 443 }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 8443 }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 80 }))).toBe(false);
  });

  it("vhost_brute triggers on HostnameFound", () => {
    const action = findAction("vhost_brute")!;
    expect(action.on(event("HostnameFound", { hostname: "test.htb" }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 80 }))).toBe(false);
  });

  it("nuclei_scan triggers on HTTP services", () => {
    const action = findAction("nuclei_scan")!;
    expect(action.on(event("PortDiscovered", { service: "http" }))).toBe(true);
    expect(action.on(event("PortDiscovered", { service: "http-proxy" }))).toBe(true);
    expect(action.on(event("PortDiscovered", { service: "ssh" }))).toBe(false);
  });

  it("smb_enum triggers on SMB ports", () => {
    const action = findAction("smb_enum")!;
    expect(action.on(event("PortDiscovered", { port: 445 }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 139 }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 80 }))).toBe(false);
  });

  it("ftp_enum triggers on FTP service", () => {
    const action = findAction("ftp_enum")!;
    expect(action.on(event("PortDiscovered", { service: "ftp" }))).toBe(true);
    expect(action.on(event("PortDiscovered", { service: "ssh" }))).toBe(false);
  });

  it("snmp_enum triggers on port 161 or snmp service", () => {
    const action = findAction("snmp_enum")!;
    expect(action.on(event("PortDiscovered", { port: 161 }))).toBe(true);
    expect(action.on(event("PortDiscovered", { service: "snmp" }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 80, service: "http" }))).toBe(false);
  });

  it("default_creds triggers on any PortDiscovered", () => {
    const action = findAction("default_creds")!;
    expect(action.on(event("PortDiscovered", { port: 22, service: "ssh" }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 80, service: "http" }))).toBe(true);
    expect(action.on(event("EngagementStarted"))).toBe(false);
  });

  it("web_vuln_tests triggers on PathDiscovered", () => {
    const action = findAction("web_vuln_tests")!;
    expect(action.on(event("PathDiscovered", { url: "/admin" }))).toBe(true);
    expect(action.on(event("PortDiscovered", { port: 80 }))).toBe(false);
  });

  it("path_traversal triggers on PathDiscovered with success status", () => {
    const action = findAction("path_traversal")!;
    expect(action.on(event("PathDiscovered", { status: 200 }))).toBe(true);
    expect(action.on(event("PathDiscovered", { status: 301 }))).toBe(true);
    expect(action.on(event("PathDiscovered", { status: 404 }))).toBe(false);
  });

  it("post_exploit_enum triggers on ShellObtained", () => {
    const action = findAction("post_exploit_enum")!;
    expect(action.on(event("ShellObtained", { user: "www-data" }))).toBe(true);
    expect(action.on(event("PortDiscovered"))).toBe(false);
  });

  it("privesc triggers on ShellObtained", () => {
    const action = findAction("privesc")!;
    expect(action.on(event("ShellObtained", { user: "www-data" }))).toBe(true);
  });

  it("cred_crack triggers on CredentialFound with hashFile", () => {
    const action = findAction("cred_crack")!;
    expect(action.on(event("CredentialFound", { hashFile: "/etc/shadow" }))).toBe(true);
    expect(action.on(event("CredentialFound", { username: "admin" }))).toBe(false);
  });

  it("stall_detection triggers on StallDetected", () => {
    const action = findAction("stall_detection")!;
    expect(action.on(event("StallDetected", { minutes: 5 }))).toBe(true);
    expect(action.on(event("EngagementStarted"))).toBe(false);
  });

  it("exploit does not trigger on low/info severity", () => {
    const action = findAction("exploit")!;
    expect(action.on(event("FindingAdded", { severity: "low" }))).toBe(false);
    expect(action.on(event("FindingAdded", { severity: "info" }))).toBe(false);
    expect(action.on(event("FindingAdded", { severity: "medium" }))).toBe(false);
  });

  it("source_code_analysis ignores non-code file types", () => {
    const action = findAction("source_code_analysis")!;
    expect(action.on(event("FileDownloaded", { type: "python" }))).toBe(true);
    expect(action.on(event("FileDownloaded", { type: "binary" }))).toBe(false);
    expect(action.on(event("FileDownloaded", { type: "image" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Run tests (mocked tool output)
// ---------------------------------------------------------------------------

describe("udp_scan", () => {
  it("parses nmap grepable UDP output", async () => {
    const action = findAction("udp_scan")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "EngagementStarted" },
      execResults: {
        nmap: {
          stdout: "Host: 10.0.0.1 ()\tPorts: 53/open/udp//domain//, 161/open/udp//snmp//\n",
          stderr: "", code: 0, durationMs: 5000,
        },
      },
    });

    await action.run!(ctx);

    const ports = ctx.emitted.filter((e) => e.type === "PortDiscovered");
    expect(ports).toHaveLength(2);
    expect(ports[0].payload.port).toBe(53);
    expect(ports[0].payload.proto).toBe("udp");
    expect(ports[0].payload.service).toBe("domain");
    expect(ports[1].payload.port).toBe(161);
  });

  it("handles empty UDP scan output", async () => {
    const action = findAction("udp_scan")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "EngagementStarted" },
      execResults: {
        nmap: { stdout: "# Nmap done\n", stderr: "", code: 0, durationMs: 5000 },
      },
    });

    await action.run!(ctx);
    expect(ctx.emitted).toHaveLength(0);
  });
});

describe("ssl_hostnames", () => {
  it("extracts SAN entries from SSL cert", async () => {
    const action = findAction("ssl_hostnames")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 443 } },
      execResults: {
        openssl: {
          stdout: "subject=CN = target.htb\nX509v3 Subject Alternative Name:\n  DNS:target.htb, DNS:www.target.htb, DNS:admin.target.htb\n",
          stderr: "", code: 0, durationMs: 100,
        },
      },
    });

    await action.run!(ctx);

    const hostnames = ctx.emitted.filter((e) => e.type === "HostnameFound");
    expect(hostnames).toHaveLength(3);
    expect(hostnames.map((h) => h.payload.hostname)).toEqual(["target.htb", "www.target.htb", "admin.target.htb"]);
    expect(hostnames[0].payload.source).toBe("ssl_cert");
  });

  it("handles no SAN entries", async () => {
    const action = findAction("ssl_hostnames")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 443 } },
      execResults: {
        openssl: { stdout: "subject=CN = 10.0.0.1\n", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);
    expect(ctx.emitted).toHaveLength(0);
  });
});

describe("vhost_brute", () => {
  it("records negative discovery when no vhosts found", async () => {
    const action = findAction("vhost_brute")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "HostnameFound", payload: { hostname: "target.htb" } },
      execResults: {
        ffuf: { stdout: ":: Progress: [5000/5000] - elapsed: 00:30", stderr: "", code: 0, durationMs: 30000 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.type === "negative" && d.category === "vhost")).toBe(true);
  });

  it("does not record negative when ffuf finds results", async () => {
    const action = findAction("vhost_brute")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "HostnameFound", payload: { hostname: "target.htb" } },
      execResults: {
        ffuf: { stdout: "| URL | Status |\nhttp://10.0.0.1/ | 200 |", stderr: "", code: 0, durationMs: 30000 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.filter((d) => d.category === "vhost")).toHaveLength(0);
  });
});

describe("nuclei_scan", () => {
  it("parses JSON line output and emits FindingAdded", async () => {
    const action = findAction("nuclei_scan")!;
    const nucleiOutput = [
      JSON.stringify({ templateID: "CVE-2021-44228", info: { name: "Log4Shell RCE", severity: "critical" } }),
      JSON.stringify({ templateID: "apache-default", info: { name: "Apache Default Page", severity: "medium" } }),
    ].join("\n");

    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      execResults: {
        nuclei: { stdout: nucleiOutput, stderr: "", code: 0, durationMs: 10000 },
      },
    });

    await action.run!(ctx);

    const findings = ctx.emitted.filter((e) => e.type === "FindingAdded");
    expect(findings).toHaveLength(2);
    expect(findings[0].payload.title).toBe("Log4Shell RCE");
    expect(findings[0].payload.severity).toBe("critical");
    expect(findings[1].payload.title).toBe("Apache Default Page");
  });

  it("handles empty nuclei output", async () => {
    const action = findAction("nuclei_scan")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
      execResults: {
        nuclei: { stdout: "", stderr: "", code: 0, durationMs: 10000 },
      },
    });

    await action.run!(ctx);
    expect(ctx.emitted).toHaveLength(0);
  });
});

describe("smb_enum", () => {
  it("detects anonymous access and records discovery", async () => {
    const action = findAction("smb_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 445 } },
      execResults: {
        enum4linux: {
          stdout: "Share Enumeration:\nAnonymous login successful\n\\\\10.0.0.1\\IPC$\n\\\\10.0.0.1\\public\n",
          stderr: "", code: 0, durationMs: 5000,
        },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.summary === "Anonymous SMB access available")).toBe(true);
    expect(ctx.discoveries.some((d) => d.summary === "SMB enumeration complete")).toBe(true);
  });

  it("records enumeration even without anonymous access", async () => {
    const action = findAction("smb_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 445 } },
      execResults: {
        enum4linux: {
          stdout: "Session setup failed: ACCESS_DENIED\n",
          stderr: "", code: 0, durationMs: 5000,
        },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.summary === "Anonymous SMB access available")).toBe(false);
    expect(ctx.discoveries.some((d) => d.summary === "SMB enumeration complete")).toBe(true);
  });
});

describe("ftp_enum", () => {
  it("detects anonymous FTP access with file listing", async () => {
    const action = findAction("ftp_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { service: "ftp" } },
      execResults: {
        curl: { stdout: "backup.tar.gz\nnotes.txt\nconfig.yml\n", stderr: "", code: 0, durationMs: 500 },
      },
    });

    await action.run!(ctx);

    const positive = ctx.discoveries.find((d) => d.type === "positive" && d.category === "ftp");
    expect(positive).toBeDefined();
    expect(positive!.detail?.files).toEqual(["backup.tar.gz", "notes.txt", "config.yml"]);
  });

  it("records negative when anonymous access denied", async () => {
    const action = findAction("ftp_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { service: "ftp" } },
      execResults: {
        curl: { stdout: "", stderr: "Access denied", code: 67, durationMs: 500 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.type === "negative" && d.category === "ftp")).toBe(true);
  });
});

describe("snmp_enum", () => {
  it("detects public community string", async () => {
    const action = findAction("snmp_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 161 } },
      execResults: {
        snmpwalk: {
          stdout: "SNMPv2-MIB::sysDescr.0 = STRING: Linux target 5.15.0\nSNMPv2-MIB::sysName.0 = STRING: target\n",
          stderr: "", code: 0, durationMs: 1000,
        },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.type === "positive" && d.summary.includes("SNMP public community string accepted"))).toBe(true);
  });

  it("records negative when community string rejected", async () => {
    const action = findAction("snmp_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PortDiscovered", payload: { port: 161 } },
      execResults: {
        snmpwalk: { stdout: "", stderr: "Timeout", code: 1, durationMs: 5000 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.type === "negative" && d.summary.includes("rejected"))).toBe(true);
  });
});

describe("path_traversal", () => {
  it("detects path traversal via /etc/passwd", async () => {
    const action = findAction("path_traversal")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PathDiscovered", payload: { url: "http://10.0.0.1/download", status: 200 } },
      execResults: {
        curl: { stdout: "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin\n", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    const findings = ctx.emitted.filter((e) => e.type === "FindingAdded");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].payload.severity).toBe("high");
    expect(ctx.discoveries.some((d) => d.type === "positive" && d.category === "traversal")).toBe(true);
  });

  it("records negative when all traversal variants fail", async () => {
    const action = findAction("path_traversal")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "PathDiscovered", payload: { url: "http://10.0.0.1/download", status: 200 } },
      execResults: {
        curl: { stdout: "404 Not Found", stderr: "", code: 0, durationMs: 100 },
      },
    });

    await action.run!(ctx);

    expect(ctx.emitted.filter((e) => e.type === "FindingAdded")).toHaveLength(0);
    expect(ctx.discoveries.some((d) => d.type === "negative" && d.category === "traversal")).toBe(true);
  });
});

describe("post_exploit_enum", () => {
  it("runs sysinfo, internalNet, localCreds and records discoveries", async () => {
    const action = findAction("post_exploit_enum")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      execResults: {
        id: { stdout: "uid=33(www-data) gid=33(www-data) groups=33(www-data)", stderr: "", code: 0, durationMs: 10 },
        uname: { stdout: "Linux target 5.15.0 #1 SMP x86_64 GNU/Linux", stderr: "", code: 0, durationMs: 10 },
        hostname: { stdout: "target", stderr: "", code: 0, durationMs: 10 },
        cat: { stdout: "", stderr: "Permission denied", code: 1, durationMs: 10 },
        ip: { stdout: "2: eth0: inet 10.0.0.1/24", stderr: "", code: 0, durationMs: 10 },
        arp: { stdout: "? (10.0.0.1) at aa:bb:cc:dd:ee:ff", stderr: "", code: 0, durationMs: 10 },
        ss: { stdout: "LISTEN 0 128 *:22 *:*", stderr: "", code: 0, durationMs: 10 },
        find: { stdout: "", stderr: "", code: 0, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.summary.includes("www-data"))).toBe(true);
    expect(ctx.discoveries.some((d) => d.category === "network")).toBe(true);
  });
});

describe("privesc", () => {
  it("runs Linux privesc checks on Linux target", async () => {
    const action = findAction("privesc")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "www-data" } },
      execResults: {
        uname: { stdout: "Linux", stderr: "", code: 0, durationMs: 10 },
        sudo: { stdout: "(ALL) NOPASSWD: /usr/bin/vim", stderr: "", code: 0, durationMs: 10 },
        find: { stdout: "/usr/bin/passwd\n/usr/bin/sudo", stderr: "", code: 0, durationMs: 100 },
        cat: { stdout: "* * * * * root /opt/cleanup.sh", stderr: "", code: 0, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.category === "privesc" && d.summary.includes("sudo"))).toBe(true);
    expect(ctx.discoveries.some((d) => d.category === "privesc" && d.summary.includes("SUID"))).toBe(true);
    expect(ctx.llmCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("runs Windows privesc checks on Windows target", async () => {
    const action = findAction("privesc")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "ShellObtained", payload: { user: "iis_user" } },
      execResults: {
        uname: { stdout: "Windows_NT", stderr: "", code: 0, durationMs: 10 },
        whoami: { stdout: "SeImpersonatePrivilege Enabled", stderr: "", code: 0, durationMs: 10 },
        sc: { stdout: "SERVICE_NAME: vulnerable_svc\nSTATE: RUNNING", stderr: "", code: 0, durationMs: 10 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.summary.includes("SeImpersonate"))).toBe(true);
  });
});

describe("cred_crack", () => {
  it("runs hashid and john, emits CredentialFound on success", async () => {
    const action = findAction("cred_crack")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "CredentialFound", payload: { hashFile: "/tmp/hashes.txt" } },
      execResults: {
        hashid: { stdout: "[+] MD5 [Hashcat Mode: 0]", stderr: "", code: 0, durationMs: 100 },
        john: { stdout: "2 passwords cracked, 0 left", stderr: "", code: 0, durationMs: 5000 },
      },
    });
    // john --show returns the cracked passwords
    ctx.execResults = {
      ...ctx.execResults,
    };

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.summary.includes("Hash type identified"))).toBe(true);
    expect(ctx.discoveries.some((d) => d.summary.includes("cracked"))).toBe(true);
    expect(ctx.emitted.some((e) => e.type === "CredentialFound")).toBe(true);
  });

  it("records negative when john fails to crack", async () => {
    const action = findAction("cred_crack")!;
    const ctx = createMockContext({
      target: "10.0.0.1",
      event: { type: "CredentialFound", payload: { hashFile: "/tmp/hashes.txt" } },
      execResults: {
        hashid: { stdout: "[+] bcrypt [Hashcat Mode: 3200]", stderr: "", code: 0, durationMs: 100 },
        john: { stdout: "0 passwords, 2 left", stderr: "", code: 0, durationMs: 30000 },
      },
    });

    await action.run!(ctx);

    expect(ctx.discoveries.some((d) => d.type === "negative" && d.summary.includes("failed to crack"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LLM-only actions (no run(), just prompt + trigger)
// ---------------------------------------------------------------------------

describe("LLM-only actions", () => {
  it("default_creds has prompt with service/port placeholders", () => {
    const action = findAction("default_creds")!;
    expect(action.run).toBeUndefined();
    expect(action.prompt).toBeDefined();
    expect(action.prompt).toContain("{service}");
    expect(action.prompt).toContain("{port}");
  });

  it("web_vuln_tests has prompt with URL placeholder", () => {
    const action = findAction("web_vuln_tests")!;
    expect(action.run).toBeUndefined();
    expect(action.prompt).toBeDefined();
    expect(action.prompt).toContain("{url}");
  });

  it("stall_detection has prompt with minutes placeholder", () => {
    const action = findAction("stall_detection")!;
    expect(action.run).toBeUndefined();
    expect(action.prompt).toBeDefined();
    expect(action.prompt).toContain("{minutes}");
  });

  it("exploit has prompt and LLM agent config", () => {
    const action = findAction("exploit")!;
    expect(action.prompt).toBeDefined();
    expect(action.llm?.agent).toBe("exploit-agent");
    expect(action.llm?.priority).toBe(1);
  });
});
