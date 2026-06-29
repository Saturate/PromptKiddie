/**
 * Default CTF playbook. Reviewed and tuned by adversarial evaluation.
 */
import type { PlaybookStep } from "./schema.js";

export interface PlaybookPhaseTemplate {
  phase: string;
  title: string;
  steps: PlaybookStep[];
}

export type PlaybookPhase = PlaybookPhaseTemplate;

export const CTF_PLAYBOOK: PlaybookPhaseTemplate[] = [
  {
    phase: "recon",
    title: "Reconnaissance",
    steps: [
      { key: "recon.start", title: "Start Recon", type: "mechanical", nodeType: "sequence", priority: 0 },

      // Port discovery - TCP and UDP in parallel
      { key: "recon.tcp_scan", title: "TCP port scan (all ports)", type: "mechanical", command: "pk exec -- rustscan -a {target}", dependsOn: ["recon.start"], priority: 5 },
      { key: "recon.udp_scan", title: "UDP top ports scan", type: "mechanical", command: "pk exec -- nmap -sU --top-ports 20 --open {target}", dependsOn: ["recon.start"], priority: 8 },

      // Service identification (after TCP ports found)
      { key: "recon.nmap_svc", title: "Nmap service + script scan", type: "mechanical", command: "pk exec -- nmap -sV -sC -p {ports} {target}", dependsOn: ["recon.tcp_scan"], priority: 10 },

      // Web recon (depends on nmap_svc so we know the actual service)
      { key: "recon.web", title: "Web Recon", type: "mechanical", nodeType: "block_ref", blockRef: "Web Recon", dependsOn: ["recon.nmap_svc"], condition: "ports.service contains http", priority: 12 },

      // SSL cert check for hostnames
      { key: "recon.ssl_names", title: "Extract hostnames from SSL certs", type: "mechanical", command: "pk exec -- echo | openssl s_client -connect {target}:443 2>/dev/null | openssl x509 -noout -ext subjectAltName -subject 2>/dev/null || echo 'no SSL'", dependsOn: ["recon.nmap_svc"], condition: "ports.port in [443,8443]", priority: 12 },

      { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.nmap_svc", "recon.web", "recon.udp_scan", "recon.ssl_names"], priority: 99 },
    ],
  },
  {
    phase: "enum",
    title: "Enumeration",
    steps: [
      { key: "enum.start", title: "Start Enumeration", type: "mechanical", nodeType: "sequence", priority: 0 },

      // /etc/hosts setup - critical for THM/HTB
      { key: "enum.hosts_file", title: "Add target to /etc/hosts", type: "judgment", description: "Add the target hostname to /etc/hosts if the box has a domain name (from SSL certs, nmap scripts, or room description). Required for vhosts and web apps.", dependsOn: ["enum.start"], priority: 2 },

      // Universal per-service checks (parallel)
      { key: "enum.fork", title: "Per-service checks", type: "mechanical", nodeType: "parallel", dependsOn: ["enum.hosts_file"], priority: 5 },
      { key: "enum.known_cves", title: "Search CVEs per service version", type: "judgment", description: "For each service+version: search searchsploit, NVD, exploit-db for known CVEs.", dependsOn: ["enum.fork"], priority: 8 },
      { key: "enum.default_creds", title: "Try default/anonymous access", type: "judgment", description: "For each service: try anonymous access (FTP, SMB null session) and default credentials (admin:admin, root:root, service-specific).", dependsOn: ["enum.fork"], priority: 8 },

      // Web enumeration (parallel with CVE/cred checks)
      { key: "enum.dir_fuzz", title: "Directory fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{target}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -mc 200,301,302,403", dependsOn: ["enum.fork"], condition: "ports.service contains http", priority: 10 },
      { key: "enum.nuclei", title: "Nuclei CVE + misconfig scan", type: "mechanical", command: "pk exec -- nuclei -u http://{target} -tags cve,misconfig,exposure,default-login", dependsOn: ["enum.fork"], condition: "ports.service contains http", priority: 10 },
      { key: "enum.vhost_fuzz", title: "Vhost/subdomain fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{target} -H 'Host: FUZZ.{target}' -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -mc 200,301,302 -fs 0", dependsOn: ["enum.hosts_file"], condition: "ports.service contains http", priority: 12, optional: true },
      { key: "enum.web_source", title: "Analyze web pages + source", type: "judgment", description: "Check robots.txt, sitemap, page source for comments, hidden forms, JS, API endpoints. Look for LFI/RFI/SQLi entry points.", dependsOn: ["enum.dir_fuzz"], priority: 15 },

      // Injection testing
      { key: "enum.sqli_test", title: "Test for SQL injection", type: "judgment", description: "Test login forms and URL parameters for SQLi. Try manual payloads first, then sqlmap if promising.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 18 },
      { key: "enum.lfi_test", title: "Test for LFI/RFI", type: "judgment", description: "Test file parameters for local/remote file inclusion: ../../etc/passwd, php://filter, etc.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 18 },

      // SMB/FTP if present
      { key: "enum.smb", title: "SMB shares + users", type: "mechanical", command: "pk exec -- enum4linux -a {target}", dependsOn: ["enum.default_creds"], condition: "ports.port in [139,445]", priority: 12 },
      { key: "enum.ftp", title: "FTP file listing + download", type: "judgment", description: "List FTP contents, download configs/backups/source code.", dependsOn: ["enum.default_creds"], condition: "ports.port = 21", priority: 12 },

      // Credential harvesting
      { key: "enum.cewl", title: "Generate wordlist from site", type: "mechanical", command: "pk exec -- cewl http://{target} -d 2 -m 5 -w /tmp/cewl.txt", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 20, optional: true },
      { key: "enum.harvest", title: "Harvest credentials + loot", type: "judgment", description: "Collect all credentials, keys, passwords, hashes found. Record each as an artifact.", dependsOn: ["enum.known_cves", "enum.nuclei", "enum.web_source", "enum.smb", "enum.ftp", "enum.sqli_test", "enum.lfi_test"], priority: 30 },

      { key: "enum.end", title: "Enumeration Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["enum.harvest"], priority: 99 },
    ],
  },
  {
    phase: "exploit",
    title: "Exploitation",
    steps: [
      { key: "exploit.start", title: "Start Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "exploit.pick", title: "Pick best attack path", type: "judgment", description: "Review findings by severity and exploitability. Pick the most promising. If previous attempt failed, exclude it and pick next.", dependsOn: ["exploit.start"], priority: 5 },
      { key: "exploit.poc", title: "Build minimal PoC", type: "judgment", description: "Create the simplest proof that works. Read-only over destructive.", dependsOn: ["exploit.pick"], priority: 10 },
      { key: "exploit.verify", title: "Adversarial verify", type: "judgment", description: "Try to disprove the finding. Check for WAF, input validation, mitigations. If false positive, go back to pick.", dependsOn: ["exploit.poc"], priority: 15 },
      { key: "exploit.shell", title: "Get initial access", type: "judgment", description: "Use the confirmed finding to get a shell or session. If this fails, loop back to pick another path.", dependsOn: ["exploit.verify"], priority: 20 },
      { key: "exploit.user_flag", title: "Capture user flag", type: "mechanical", command: "pk exec -- find / -name user.txt -o -name user.txt 2>/dev/null | head -5 && cat /home/*/user.txt 2>/dev/null || dir C:\\Users\\*\\Desktop\\user.txt 2>nul", dependsOn: ["exploit.shell"], priority: 25 },
      { key: "exploit.end", title: "Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["exploit.user_flag"], priority: 99 },
    ],
  },
  {
    phase: "postexploit",
    title: "Post-Exploitation",
    steps: [
      { key: "post.start", title: "Start Post-Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "post.sysinfo", title: "System info", type: "mechanical", command: "pk exec -- id && whoami && uname -a && hostname && cat /etc/os-release 2>/dev/null", dependsOn: ["post.start"], priority: 5 },

      // Credential harvesting from compromised box
      { key: "post.local_creds", title: "Harvest local credentials", type: "judgment", description: "Check bash_history, .ssh/*, database configs (wp-config.php, .env), browser saved passwords, /etc/shadow if readable.", dependsOn: ["post.sysinfo"], priority: 8 },

      // Internal network check
      { key: "post.internal_net", title: "Internal network recon", type: "mechanical", command: "pk exec -- ip addr && ip route && arp -a && ss -tlnp", dependsOn: ["post.sysinfo"], priority: 10 },

      // Automated + manual privesc
      { key: "post.privesc", title: "Privilege Escalation", type: "mechanical", nodeType: "block_ref", blockRef: "Privilege Escalation", dependsOn: ["post.local_creds"], priority: 12 },

      { key: "post.root_flag", title: "Capture root flag", type: "mechanical", command: "pk exec -- find / -name root.txt 2>/dev/null | head -5 && cat /root/root.txt 2>/dev/null || dir C:\\Users\\Administrator\\Desktop\\root.txt 2>nul", dependsOn: ["post.privesc"], priority: 35 },
      { key: "post.end", title: "Post-Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["post.root_flag", "post.internal_net"], priority: 99 },
    ],
  },
  {
    phase: "report",
    title: "Reporting",
    steps: [
      { key: "report.start", title: "Start Reporting", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "report.evidence", title: "Verify evidence coverage", type: "judgment", description: "Each finding needs evidence. Each flag needs a capture record.", dependsOn: ["report.start"], priority: 10 },
      { key: "report.classify", title: "Tag findings (CWE, CVSS)", type: "judgment", description: "Add CWE, CVSS vectors, OWASP refs to each finding.", dependsOn: ["report.evidence"], priority: 20 },
      { key: "report.generate", title: "Generate report", type: "mechanical", command: "pk report generate", dependsOn: ["report.classify"], priority: 30 },
      { key: "report.end", title: "Engagement Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["report.generate"], priority: 99 },
    ],
  },
];

export const DEFAULT_PLAYBOOKS: Record<string, { name: string; description: string; phases: PlaybookPhaseTemplate[] }> = {
  ctf: {
    name: "CTF Default",
    description: "Capture-the-flag: scan, enumerate per service, exploit, escalate, capture flags.",
    phases: CTF_PLAYBOOK,
  },
};
