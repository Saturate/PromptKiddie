import type { Action, Playbook } from "../sdk.js";
import { webFingerprint, headerInspect } from "./shared/web-recon.js";
import { linuxPrivesc, windowsPrivesc } from "./shared/privesc.js";
import { crackHashes } from "./shared/cred-cracking.js";

const portScan: Action = {
  name: "port_scan",
  description: "Full TCP port scan with service detection",
  on: (e) => e.type === "EngagementStarted",
  tier: "auto",
  emits: ["PortDiscovered", "VersionIdentified"],
  async run(ctx) {
    const result = await ctx.exec("rustscan", ["-a", ctx.target, "--", "-sV", "-sC", "-oX", "-"], { stream: true });
    await ctx.evidence(`exec/rustscan-${Date.now()}.txt`, "scan");

    const lines = result.stdout.split("\n");
    for (const line of lines) {
      const portMatch = line.match(/(\d+)\/tcp\s+open\s+(\S+)\s*(.*)/);
      if (portMatch) {
        const [, port, service, version] = portMatch;
        await ctx.emit("PortDiscovered", {
          port: parseInt(port, 10),
          proto: "tcp",
          service,
          version: version.trim() || null,
        });
      }
    }
  },
};

const webRecon: Action = {
  name: "web_recon",
  description: "Web fingerprinting and hostname discovery on HTTP ports",
  on: (e) => e.type === "PortDiscovered" && (e.payload.service === "http" || e.payload.service === "http-proxy"),
  tier: "auto",
  emits: ["VersionIdentified", "HostnameFound"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    await Promise.all([
      webFingerprint(ctx, port),
      headerInspect(ctx, port),
    ]);
  },
};

const sslHostnames: Action = {
  name: "ssl_hostnames",
  description: "Extract hostnames from SSL certificates",
  on: (e) => e.type === "PortDiscovered" && [443, 8443, 9443].includes(e.payload.port as number),
  tier: "auto",
  emits: ["HostnameFound"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    const result = await ctx.exec("openssl", ["s_client", "-connect", `${ctx.target}:${port}`, "-servername", ctx.target]);
    const sanMatch = result.stdout.match(/DNS:([^\s,]+)/g);
    if (sanMatch) {
      for (const san of sanMatch) {
        const hostname = san.replace("DNS:", "");
        await ctx.emit("HostnameFound", { hostname, source: "ssl_cert", port });
      }
    }
  },
};

const dirBrute: Action = {
  name: "dir_brute",
  description: "Directory and file discovery on web services",
  on: (e) => e.type === "PortDiscovered" && (e.payload.service === "http" || e.payload.service === "http-proxy"),
  tier: "auto",
  emits: ["FileDownloaded", "PathDiscovered"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    const result = await ctx.exec("ffuf", [
      "-u", `http://${ctx.target}:${port}/FUZZ`,
      "-w", "/usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt",
      "-mc", "all", "-fc", "404", "-t", "50", "-timeout", "10",
      "-o", "/tmp/ffuf-dirs.json", "-of", "json",
    ], { stream: true });

    if (result.code === 0) {
      try {
        const content = await ctx.readFile("/tmp/ffuf-dirs.json");
        const data = JSON.parse(content) as { results?: Array<{ url: string; status: number; length: number }> };
        const paths = data.results ?? [];
        for (const p of paths) {
          await ctx.emit("PathDiscovered", { url: p.url, status: p.status, size: p.length });
        }
        if (paths.length === 0) {
          await ctx.discover("negative", "web", `ffuf: 0 directories on port ${port}`);
        }
      } catch {
        await ctx.discover("negative", "web", `ffuf output parse failed on port ${port}`);
      }
    }
  },
};

const vhostBrute: Action = {
  name: "vhost_brute",
  description: "Virtual host discovery",
  on: (e) => e.type === "HostnameFound",
  tier: "auto",
  emits: ["HostnameFound"],
  async run(ctx) {
    const hostname = ctx.event.payload.hostname as string;
    const domain = hostname.split(".").slice(-2).join(".");
    const result = await ctx.exec("ffuf", [
      "-u", `http://${ctx.target}/`,
      "-H", `Host: FUZZ.${domain}`,
      "-w", "/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt",
      "-mc", "all", "-fc", "301", "-fs", "0", "-t", "50",
    ]);

    const matches = result.stdout.match(/\| URL \| .+ \|/g);
    if (!matches?.length) {
      await ctx.discover("negative", "vhost", `No vhosts found for ${domain}`);
    }
  },
};

const cveSearch: Action = {
  name: "cve_search",
  description: "Search for known CVEs matching discovered versions",
  on: (e) => e.type === "VersionIdentified" && e.payload.version != null,
  tier: "both",
  emits: ["ExploitAvailable"],
  async run(ctx) {
    const { product, version } = ctx.event.payload;

    const searchsploit = await ctx.exec("searchsploit", [product as string, version as string]);
    if (searchsploit.stdout.trim() && !searchsploit.stdout.includes("No results")) {
      await ctx.discover("positive", "cve", `searchsploit hits for ${product} ${version}`, { raw: searchsploit.stdout.slice(0, 1000) });
    } else {
      await ctx.discover("negative", "cve", `searchsploit: 0 results for ${product} ${version}`);
    }

    const hits = await ctx.searchExploitIndex(product as string, version as string);
    for (const hit of hits) {
      await ctx.emit("ExploitAvailable", { cve: hit.cve, product: hit.product, cvss: hit.cvss, pocPath: hit.pocPath });
    }

    if (hits.length === 0) {
      await ctx.spawnLlm(
        `Search the web for CVEs and PoC exploits for ${product} ${version}. ` +
        `Check GitHub for public PoC scripts. Report any findings with CVE number, CVSS, and PoC URL.`
      );
    }
  },
};

const sourceCodeAnalysis: Action = {
  name: "source_code_analysis",
  description: "Analyze downloaded source code for vulnerabilities",
  on: (e) => e.type === "FileDownloaded" && ["python", "javascript", "php", "java", "ruby", "go"].includes(e.payload.type as string),
  tier: "both",
  emits: ["FindingAdded"],
  async run(ctx) {
    const path = ctx.event.payload.path as string;
    const grep = await ctx.exec("grep", ["-n", "subprocess\\|exec\\|eval\\|system\\|shell=True\\|os.popen\\|Runtime.getRuntime", path]);

    const analysis = await ctx.spawnLlm(
      `Analyze ${path} for vulnerabilities. Focus on injection points, auth bypasses, path traversal, deserialization.\n` +
      (grep.stdout.trim() ? `Grep hits for dangerous functions:\n${grep.stdout}` : "No obvious dangerous function calls found by grep.")
    );

    ctx.reprioritize("dir_brute", 80);
    ctx.log(`Source code analyzed: ${path}`);
  },
};

const exploitAvailable: Action = {
  name: "exploit",
  description: "Exploit a critical or high-severity finding",
  on: (e) => e.type === "FindingAdded" && ["critical", "high"].includes(e.payload.severity as string),
  tier: "llm",
  emits: ["ShellObtained", "CredentialFound"],
  async run(ctx) {
    const finding = ctx.event.payload;
    await ctx.spawnLlm(
      `Exploit this finding and get a shell.\n` +
      `Target: ${ctx.target}\n` +
      `Finding: ${finding.title}\n` +
      `Details: ${finding.description}\n` +
      `Severity: ${finding.severity}, CVSS: ${finding.cvss ?? "unknown"}`,
      { agentType: "exploit-agent", priority: 1 }
    );
  },
};

const privesc: Action = {
  name: "privesc",
  description: "Privilege escalation after obtaining a shell",
  on: (e) => e.type === "ShellObtained",
  tier: "both",
  emits: ["ShellObtained", "FlagCaptured"],
  async run(ctx) {
    const os = await ctx.exec("uname", ["-s"]);
    if (os.stdout.trim().toLowerCase().includes("linux")) {
      await linuxPrivesc(ctx);
    } else {
      await windowsPrivesc(ctx);
    }
  },
};

const credCrack: Action = {
  name: "cred_crack",
  description: "Crack discovered credential hashes",
  on: (e) => e.type === "CredentialFound" && e.payload.hashFile != null,
  tier: "both",
  emits: ["CredentialFound"],
  async run(ctx) {
    await crackHashes(ctx, ctx.event.payload.hashFile as string);
  },
};

const flagCapture: Action = {
  name: "flag_capture",
  description: "Search for and capture CTF flags",
  on: (e) => e.type === "ShellObtained",
  tier: "auto",
  emits: ["FlagCaptured"],
  async run(ctx) {
    const user = await ctx.exec("find", ["/home", "-name", "user.txt", "-type", "f"]);
    if (user.stdout.trim()) {
      const flag = await ctx.exec("cat", [user.stdout.trim().split("\n")[0]]);
      if (flag.stdout.trim()) {
        await ctx.emit("FlagCaptured", { type: "user", value: flag.stdout.trim(), path: user.stdout.trim() });
      }
    }

    const root = await ctx.exec("cat", ["/root/root.txt"]);
    if (root.code === 0 && root.stdout.trim()) {
      await ctx.emit("FlagCaptured", { type: "root", value: root.stdout.trim(), path: "/root/root.txt" });
    }
  },
};

const stallDetection: Action = {
  name: "stall_detection",
  description: "Invoke LLM when no progress has been made",
  on: (e) => e.type === "StallDetected",
  tier: "llm",
  async run(ctx) {
    await ctx.spawnLlm(
      `No new discoveries in ${ctx.event.payload.minutes} minutes. ` +
      `Review the engagement state and suggest what to try next. ` +
      `Consider: services not fully enumerated, attack paths not attempted, lateral movement opportunities.`
    );
  },
};

export const CTF_PLAYBOOK: Playbook = {
  name: "CTF Default",
  description: "Reactive CTF playbook: scan, enumerate per service, exploit, escalate, capture flags.",
  actions: [
    portScan,
    webRecon,
    sslHostnames,
    dirBrute,
    vhostBrute,
    cveSearch,
    sourceCodeAnalysis,
    exploitAvailable,
    privesc,
    credCrack,
    flagCapture,
    stallDetection,
  ],
};
