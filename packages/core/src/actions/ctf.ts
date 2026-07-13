import type { Action, Playbook } from "../sdk.js";
import { webFingerprint, headerInspect } from "./shared/web-recon.js";
import { linuxPrivesc, windowsPrivesc } from "./shared/privesc.js";
import { crackHashes } from "./shared/cred-cracking.js";
import { sysinfo, localCreds, internalNet } from "./shared/post-exploit.js";
import { pathTraversal } from "./shared/path-traversal.js";

/** @module Recon */

const portScan: Action = {
  name: "port_scan",
  description: "Full TCP port scan with service detection",
  on: (e) => e.type === "EngagementStarted",
  emits: ["PortDiscovered", "VersionIdentified"],
  async run(ctx) {
    const result = await ctx.exec("rustscan", ["-a", ctx.target, "--", "-sV", "-sC"], { stream: true });
    await ctx.evidence(`exec/rustscan-${Date.now()}.txt`, "scan");
    const lines = result.stdout.split("\n");
    for (const line of lines) {
      const portMatch = line.match(/(\d+)\/tcp\s+open\s+(\S+)\s*(.*)/);
      if (portMatch) {
        const [, port, service, version] = portMatch;
        const ver = version.trim() || null;
        await ctx.emit("PortDiscovered", { port: parseInt(port, 10), proto: "tcp", service, version: ver });
        if (ver) {
          const product = service === "http" ? ver.split("/")[0] : service;
          await ctx.emit("VersionIdentified", { port: parseInt(port, 10), service, product, version: ver });
        }
      }
    }
  },
};

const udpScan: Action = {
  name: "udp_scan",
  description: "Top 20 UDP port scan",
  on: (e) => e.type === "EngagementStarted",
  emits: ["PortDiscovered"],
  async run(ctx) {
    const result = await ctx.exec("nmap", ["-sU", "--top-ports", "20", "--open", "-oG", "-", ctx.target]);
    const lines = result.stdout.split("\n");
    for (const line of lines) {
      const portMatches = line.matchAll(/(\d+)\/open\/udp\/+([^/]*)/g);
      for (const m of portMatches) {
        await ctx.emit("PortDiscovered", { port: parseInt(m[1], 10), proto: "udp", service: m[2].trim() || "unknown", version: null });
      }
    }
  },
};

const webRecon: Action = {
  name: "web_recon",
  description: "Web fingerprinting and hostname discovery on HTTP ports",
  on: (e) => e.type === "PortDiscovered" && ["http", "http-proxy", "https"].includes(e.payload.service as string),
  emits: ["VersionIdentified", "HostnameFound"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    await Promise.all([webFingerprint(ctx, port), headerInspect(ctx, port)]);
  },
};

const sslHostnames: Action = {
  name: "ssl_hostnames",
  description: "Extract hostnames from SSL certificates",
  on: (e) => e.type === "PortDiscovered" && [443, 8443, 9443].includes(e.payload.port as number),
  emits: ["HostnameFound"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    const result = await ctx.exec("openssl", ["s_client", "-connect", `${ctx.target}:${port}`, "-servername", ctx.target]);
    const sanMatch = result.stdout.match(/DNS:([^\s,]+)/g);
    if (sanMatch) {
      for (const san of sanMatch) {
        await ctx.emit("HostnameFound", { hostname: san.replace("DNS:", ""), source: "ssl_cert", port });
      }
    }
  },
};

const dirBrute: Action = {
  name: "dir_brute",
  description: "Directory and file discovery on web services",
  on: (e) => e.type === "PortDiscovered" && ["http", "http-proxy"].includes(e.payload.service as string),
  emits: ["FileDownloaded", "PathDiscovered"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    const outFile = `/tmp/ffuf-dirs-${port}-${Date.now()}.json`;
    const result = await ctx.exec("ffuf", [
      "-u", `http://${ctx.target}:${port}/FUZZ`,
      "-w", "/usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt",
      "-mc", "all", "-fc", "404", "-t", "50", "-timeout", "10",
      "-o", outFile, "-of", "json",
    ], { stream: true });
    if (result.code === 0) {
      try {
        const content = await ctx.readFile(outFile);
        const data = JSON.parse(content) as { results?: Array<{ url: string; status: number; length: number }> };
        for (const p of data.results ?? []) {
          await ctx.emit("PathDiscovered", { url: p.url, status: p.status, size: p.length });
        }
        if (!data.results?.length) await ctx.discover("negative", "web", `ffuf: 0 directories on port ${port}`);
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
  emits: ["HostnameFound"],
  async run(ctx) {
    const hostname = ctx.event.payload.hostname as string;
    const domain = hostname.split(".").slice(-2).join(".");
    const result = await ctx.exec("ffuf", [
      "-u", `http://${ctx.target}/`, "-H", `Host: FUZZ.${domain}`,
      "-w", "/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt",
      "-mc", "all", "-fc", "301", "-fs", "0", "-t", "50",
    ]);
    if (!result.stdout.includes("| URL |")) {
      await ctx.discover("negative", "vhost", `No vhosts found for ${domain}`);
    }
  },
};

/** @module Enumeration */

const nucleiScan: Action = {
  name: "nuclei_scan",
  description: "Nuclei CVE and misconfiguration scan on HTTP services",
  on: (e) => e.type === "PortDiscovered" && ["http", "http-proxy"].includes(e.payload.service as string),
  emits: ["FindingAdded"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    const result = await ctx.exec("nuclei", [
      "-u", `http://${ctx.target}:${port}`,
      "-tags", "cve,misconfig,exposure,default-login",
      "-severity", "medium,high,critical", "-j",
    ], { stream: true });
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const hit = JSON.parse(line) as Record<string, unknown>;
        await ctx.emit("FindingAdded", {
          title: hit.info && (hit.info as Record<string, unknown>).name || hit.templateID,
          severity: hit.info && (hit.info as Record<string, unknown>).severity || "medium",
          source: "nuclei",
        });
      } catch { /* skip malformed lines */ }
    }
  },
};

const smbEnum: Action = {
  name: "smb_enum",
  description: "SMB share and user enumeration",
  on: (e) => e.type === "PortDiscovered" && [139, 445].includes(e.payload.port as number),
  emits: ["CredentialFound"],
  async run(ctx) {
    const result = await ctx.exec("enum4linux", ["-a", ctx.target]);
    if (result.stdout.includes("Anonymous")) {
      await ctx.discover("positive", "smb", "Anonymous SMB access available");
    }
    await ctx.discover("positive", "smb", "SMB enumeration complete", { raw: result.stdout.slice(0, 2000) });
  },
};

const ftpEnum: Action = {
  name: "ftp_enum",
  description: "FTP anonymous access and file listing",
  on: (e) => e.type === "PortDiscovered" && e.payload.service === "ftp",
  emits: ["FileDownloaded"],
  async run(ctx) {
    const result = await ctx.exec("curl", [`ftp://${ctx.target}/`, "--user", "anonymous:anonymous", "-l"]);
    if (result.code === 0 && result.stdout.trim()) {
      await ctx.discover("positive", "ftp", "Anonymous FTP access", { files: result.stdout.trim().split("\n") });
    } else {
      await ctx.discover("negative", "ftp", "No anonymous FTP access");
    }
  },
};

const snmpEnum: Action = {
  name: "snmp_enum",
  description: "SNMP enumeration with public community string",
  on: (e) => e.type === "PortDiscovered" && (e.payload.port === 161 || e.payload.service === "snmp"),
  async run(ctx) {
    const result = await ctx.exec("snmpwalk", ["-v2c", "-c", "public", ctx.target]);
    if (result.code === 0 && result.stdout.trim()) {
      await ctx.discover("positive", "snmp", "SNMP public community string accepted", { raw: result.stdout.slice(0, 2000) });
    } else {
      await ctx.discover("negative", "snmp", "SNMP public community string rejected");
    }
  },
};

const imapEnum: Action = {
  name: "imap_enum",
  description: "IMAP/POP3 banner grab and capability enumeration",
  on: (e) => e.type === "PortDiscovered" && ["imap", "pop3", "imaps", "pop3s", "ssl/imap", "ssl/pop3"].includes(e.payload.service as string),
  emits: ["VersionIdentified"],
  async run(ctx) {
    const port = ctx.event.payload.port as number;
    const result = await ctx.exec("nmap", ["-sV", "--script", "imap-capabilities,pop3-capabilities,banner", "-p", String(port), ctx.target]);
    const verMatch = result.stdout.match(/Dovecot\s+(\S+)|Cyrus\s+(\S+)|Courier\s+(\S+)|hMailServer\s+(\S+)/i);
    if (verMatch) {
      const product = result.stdout.match(/(Dovecot|Cyrus|Courier|hMailServer)/i)?.[1] ?? "imap";
      const version = verMatch.slice(1).find(Boolean) ?? "";
      if (version) {
        await ctx.emit("VersionIdentified", { product, version, source: "imap_banner", port });
      }
    }
    await ctx.discover("positive", "mail", `Mail service enumerated on port ${port}`, { raw: result.stdout.slice(0, 1000) });
  },
};

const nfsEnum: Action = {
  name: "nfs_enum",
  description: "NFS share enumeration and file listing",
  on: (e) => e.type === "PortDiscovered" && (e.payload.port === 2049 || e.payload.service === "nfs"),
  emits: ["FileDownloaded", "CredentialFound"],
  async run(ctx) {
    const showmount = await ctx.exec("nmap", ["--script", "nfs-showmount,nfs-ls", "-p", "111,2049", ctx.target]);
    const shares: string[] = [];
    for (const line of showmount.stdout.split("\n")) {
      const m = line.match(/\|\s+(\/\S+)/);
      if (m) shares.push(m[1]);
    }
    if (shares.length === 0) {
      await ctx.discover("negative", "nfs", "No NFS shares found or showmount failed");
      return;
    }
    for (const share of shares) {
      await ctx.discover("positive", "nfs", `NFS share: ${share}`);
      const mount = await ctx.exec("sh", ["-c",
        `mkdir -p /mnt/nfs_enum && mount -t nfs -o nolock,vers=3 ${ctx.target}:${share} /mnt/nfs_enum 2>&1 && find /mnt/nfs_enum -type f -maxdepth 3 2>/dev/null && umount /mnt/nfs_enum`]);
      if (mount.code === 0 && mount.stdout.trim()) {
        const files = mount.stdout.trim().split("\n");
        await ctx.discover("positive", "nfs", `${files.length} files in ${share}`, { files: files.slice(0, 20) });
        for (const f of files) {
          if (/\.(pdf|txt|conf|cfg|bak|sql|key|pem|ovpn)$/i.test(f)) {
            await ctx.emit("FileDownloaded", { path: f, share, source: "nfs" });
          }
        }
      }
    }
  },
};

const cveSearch: Action = {
  name: "cve_search",
  description: "Search for known CVEs matching discovered versions",
  on: (e) => e.type === "VersionIdentified" && e.payload.version != null,
  emits: ["ExploitAvailable"],
  prompt: "Search the web for CVEs and PoC exploits for {product} {version}. Check GitHub for public PoC scripts. Report findings with CVE number, CVSS, and PoC URL.",
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
  },
};

const sourceCodeAnalysis: Action = {
  name: "source_code_analysis",
  description: "Analyze downloaded source code for vulnerabilities",
  on: (e) => e.type === "FileDownloaded" && ["python", "javascript", "php", "java", "ruby", "go"].includes(e.payload.type as string),
  emits: ["FindingAdded"],
  prompt: "Analyze {path} for injection, auth bypass, path traversal, deserialization vulnerabilities. Grep hits for dangerous functions:\n{grep_results}",
  async run(ctx) {
    const path = ctx.event.payload.path as string;
    const grep = await ctx.exec("grep", ["-n", "subprocess\\|exec\\|eval\\|system\\|shell=True\\|os.popen\\|Runtime.getRuntime", path]);
    ctx.reprioritize("dir_brute", 80);
  },
};

const defaultCreds: Action = {
  name: "default_creds",
  description: "Try default and anonymous credentials per service",
  on: (e) => e.type === "PortDiscovered",
  emits: ["CredentialFound"],
  prompt: "Try default and anonymous credentials for {service} on port {port}. Common defaults: admin:admin, root:root, service-specific defaults. Report any successful authentication.",
  llm: { priority: 30 },
};

const webVulnTests: Action = {
  name: "web_vuln_tests",
  description: "Test web endpoints for SQLi, LFI, SSTI, command injection, XXE, SSRF",
  on: (e) => e.type === "PathDiscovered",
  emits: ["FindingAdded"],
  prompt: "Test this web endpoint for vulnerabilities: SQLi (try sqlmap if promising), LFI/RFI (../../etc/passwd, php://filter), SSTI ({{7*7}}), command injection (; id, | whoami), XXE (if XML accepted), SSRF (internal IPs, cloud metadata). Endpoint: {url}",
  llm: { priority: 20 },
};

const pathTraversalAction: Action = {
  name: "path_traversal",
  description: "Test file download/upload endpoints with encoding bypasses",
  on: (e) => e.type === "PathDiscovered" && [200, 301, 302].includes(e.payload.status as number),
  emits: ["FindingAdded"],
  async run(ctx) {
    const url = ctx.event.payload.url as string;
    await pathTraversal(ctx, url);
  },
};

/** @module Exploitation */

const exploit: Action = {
  name: "exploit",
  description: "Exploit a critical or high-severity finding to get a shell",
  on: (e) => e.type === "FindingAdded" && ["critical", "high"].includes(e.payload.severity as string),
  emits: ["ShellObtained", "CredentialFound"],
  prompt: "Exploit this finding and get a shell. Target: {target}. Finding: {title}. Details: {description}. Severity: {severity}.",
  llm: { agent: "exploit-agent", model: "opus", session: "fresh", priority: 1 },
};

/** @module Post-exploitation */

const postExploitEnum: Action = {
  name: "post_exploit_enum",
  description: "System enumeration after obtaining a shell",
  on: (e) => e.type === "ShellObtained",
  async run(ctx) {
    await sysinfo(ctx);
    await internalNet(ctx);
    await localCreds(ctx);
  },
};

const privesc: Action = {
  name: "privesc",
  description: "Privilege escalation",
  on: (e) => e.type === "ShellObtained",
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
  emits: ["CredentialFound"],
  async run(ctx) {
    await crackHashes(ctx, ctx.event.payload.hashFile as string);
  },
};

const flagCapture: Action = {
  name: "flag_capture",
  description: "Search for and capture CTF flags",
  on: (e) => e.type === "ShellObtained",
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

/** @module Fallback */

const stallDetection: Action = {
  name: "stall_detection",
  description: "Invoke LLM when no progress has been made",
  on: (e) => e.type === "StallDetected",
  prompt: "No new discoveries in {minutes} minutes. Review engagement state and suggest what to try next. Consider: services not enumerated, attack paths not attempted, lateral movement opportunities.",
};

/** @module Playbook */

export const CTF_PLAYBOOK: Playbook = {
  name: "CTF Default",
  description: "Reactive CTF playbook: scan, enumerate per service, exploit, escalate, capture flags.",
  actions: [
    // Recon
    portScan, udpScan, webRecon, sslHostnames, dirBrute, vhostBrute,
    // Enumeration
    nucleiScan, smbEnum, ftpEnum, snmpEnum, nfsEnum, imapEnum,
    cveSearch, sourceCodeAnalysis, defaultCreds,
    webVulnTests, pathTraversalAction,
    // Exploitation
    exploit,
    // Post-exploitation
    postExploitEnum, privesc, credCrack, flagCapture,
    // Fallback
    stallDetection,
  ],
};
