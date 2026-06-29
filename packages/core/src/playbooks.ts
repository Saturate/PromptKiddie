/**
 * Default playbook templates per engagement type.
 * Seeded on first run. Users can customize or create their own.
 *
 * Each phase has meta nodes (start/end) that act as sync points.
 * Steps between meta nodes can fork and run in parallel.
 * Conditions gate steps on discovered state (ports, services, findings).
 */
import type { PlaybookStep } from "./schema.js";

export interface PlaybookPhaseTemplate {
  phase: string;
  title: string;
  steps: PlaybookStep[];
}

export const CTF_PLAYBOOK: PlaybookPhaseTemplate[] = [
  {
    phase: "recon",
    title: "Reconnaissance",
    steps: [
      // Meta: phase start
      { key: "recon.start", title: "Start Recon", type: "mechanical", nodeType: "sequence", priority: 0 },

      // Port discovery
      { key: "recon.port_scan", title: "Full port scan (all 65535)", type: "mechanical", command: "pk exec -- rustscan -a {target} -- -sV", dependsOn: ["recon.start"], priority: 5 },

      // Service identification (parallel after ports found)
      { key: "recon.nmap_svc", title: "Nmap service + script scan", type: "mechanical", command: "pk exec -- nmap -sV -sC -p {ports} {target}", dependsOn: ["recon.port_scan"], priority: 10 },
      { key: "recon.web_tech", title: "Web stack fingerprint", type: "mechanical", command: "pk exec -- whatweb http://{target}:{port} --color=never", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 10, description: "Identifies CMS, framework, language, server, plugins. Goes deeper than nmap banner grabbing." },
      { key: "recon.waf_detect", title: "WAF detection", type: "mechanical", command: "pk exec -- wafw00f http://{target}:{port}", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 12, description: "Detect WAF/CDN that may block scanning. Adjust techniques if found." },
      { key: "recon.http_headers", title: "Inspect HTTP headers", type: "mechanical", command: "pk exec -- curl -sI http://{target}:{port}", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 11, description: "Check Server, X-Powered-By, cookies (PHPSESSID=PHP, JSESSIONID=Java), security headers." },
      { key: "recon.favicon_hash", title: "Favicon hash lookup", type: "mechanical", command: "pk exec -- python3 -c \"import hashlib,codecs,requests;r=requests.get('http://{target}:{port}/favicon.ico');print('mmh3:',hashlib.md5(codecs.encode(r.content,'base64')).hexdigest())\" 2>/dev/null || pk exec -- curl -s http://{target}:{port}/favicon.ico | md5sum", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 13, description: "Hash the favicon to identify the product. Look up on Shodan (http.favicon.hash) or FOFA." },

      { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.nmap_svc", "recon.web_tech", "recon.waf_detect", "recon.http_headers", "recon.favicon_hash"], priority: 99 },
    ],
  },
  {
    phase: "enum",
    title: "Enumeration",
    steps: [
      { key: "enum.start", title: "Start Enumeration", type: "mechanical", nodeType: "sequence", priority: 0 },

      // Universal checks applied to EVERY discovered service
      { key: "enum.known_cves", title: "Check known CVEs per service", type: "judgment", description: "For each service+version from recon: search for known CVEs in searchsploit, NVD, exploit-db. Record as triage findings.", dependsOn: ["enum.start"], priority: 5 },
      { key: "enum.default_creds", title: "Try default/anonymous access", type: "judgment", description: "For each service: try anonymous access (FTP, SMB null session) and default credentials (admin:admin, root:root, service-specific defaults). Record what works.", dependsOn: ["enum.start"], priority: 5 },
      { key: "enum.nuclei", title: "Automated vulnerability scan", type: "mechanical", command: "pk exec -- nuclei -u http://{target} -tags cve,misconfig,exposure,default-login", dependsOn: ["enum.start"], condition: "ports.service contains http", priority: 10 },

      // Service-specific deep enumeration (parallel)
      { key: "enum.web_content", title: "Web content discovery", type: "mechanical", command: "pk exec -- ffuf -u http://{target}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -mc 200,301,302,403", dependsOn: ["enum.default_creds"], condition: "ports.service contains http", priority: 15 },
      { key: "enum.web_source", title: "Analyze web pages", type: "judgment", description: "Check robots.txt, sitemap.xml, page source for comments/hidden forms/JS/API endpoints. View interesting directories found by fuzzing.", dependsOn: ["enum.web_content"], priority: 20 },
      { key: "enum.smb_shares", title: "Enumerate SMB shares + files", type: "mechanical", command: "pk exec -- enum4linux -a {target} && smbclient -L //{target} -N", dependsOn: ["enum.default_creds"], condition: "ports.port in [139,445]", priority: 15 },
      { key: "enum.ftp_files", title: "List and download FTP files", type: "judgment", description: "List FTP contents. Download configs, backups, source code, anything interesting.", dependsOn: ["enum.default_creds"], condition: "ports.port = 21", priority: 15 },

      // Consolidate
      { key: "enum.harvest_creds", title: "Harvest credentials from findings", type: "judgment", description: "Collect all credentials found: default creds that worked, keys in files, passwords in configs, hashes in databases. Record each as an artifact.", dependsOn: ["enum.web_source", "enum.smb_shares", "enum.ftp_files", "enum.known_cves", "enum.nuclei"], priority: 30 },

      { key: "enum.end", title: "Enumeration Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["enum.harvest_creds"], priority: 99 },
    ],
  },
  {
    phase: "exploit",
    title: "Exploitation",
    steps: [
      { key: "exploit.start", title: "Start Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },

      { key: "exploit.review_findings", title: "Review triage findings", type: "judgment", description: "List all findings. Pick the highest-severity, most exploitable one. Validate it's real before proceeding.", dependsOn: ["exploit.start"], priority: 5 },
      { key: "exploit.build_poc", title: "Build minimal PoC", type: "judgment", description: "Create the simplest proof-of-concept. Read-only proof over destructive where possible.", dependsOn: ["exploit.review_findings"], priority: 10 },
      { key: "exploit.verify_finding", title: "Adversarial verify", type: "judgment", description: "Assume the finding is wrong. Try to disprove it. Check for mitigations, WAF, input validation. Only proceed if confirmed.", dependsOn: ["exploit.build_poc"], priority: 15 },
      { key: "exploit.get_shell", title: "Gain initial access", type: "judgment", description: "Use the confirmed finding to get a shell or authenticated session. Capture evidence.", dependsOn: ["exploit.verify_finding"], priority: 20 },
      { key: "exploit.user_flag", title: "Capture user flag", type: "mechanical", command: "pk exec -- cat /home/*/user.txt || find / -name user.txt 2>/dev/null", dependsOn: ["exploit.get_shell"], priority: 25 },

      { key: "exploit.end", title: "Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["exploit.user_flag"], priority: 99 },
    ],
  },
  {
    phase: "postexploit",
    title: "Post-Exploitation",
    steps: [
      { key: "post.start", title: "Start Post-Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },

      { key: "post.sysinfo", title: "System information", type: "mechanical", command: "pk exec -- id && whoami && uname -a && cat /etc/os-release && hostname", dependsOn: ["post.start"], priority: 5 },

      // Parallel privesc checks
      { key: "post.sudo", title: "Check sudo permissions", type: "mechanical", command: "pk exec -- sudo -l 2>/dev/null", dependsOn: ["post.sysinfo"], priority: 10 },
      { key: "post.suid", title: "Find SUID binaries", type: "mechanical", command: "pk exec -- find / -perm -4000 -type f 2>/dev/null", dependsOn: ["post.sysinfo"], priority: 10 },
      { key: "post.cron", title: "Check cron jobs", type: "mechanical", command: "pk exec -- cat /etc/crontab && ls -la /etc/cron.* 2>/dev/null && crontab -l 2>/dev/null", dependsOn: ["post.sysinfo"], priority: 15 },
      { key: "post.writable", title: "Writable files/dirs", type: "mechanical", command: "pk exec -- find / -writable -type f 2>/dev/null | grep -v proc | head -30", dependsOn: ["post.sysinfo"], priority: 20 },
      { key: "post.configs", title: "Search for credentials", type: "mechanical", command: "pk exec -- find / -name '*.conf' -o -name '*.cfg' -o -name '.env' -o -name 'wp-config*' 2>/dev/null | head -20", dependsOn: ["post.sysinfo"], priority: 15 },
      { key: "post.network", title: "Internal network recon", type: "mechanical", command: "pk exec -- ip addr && ip route && ss -tlnp", dependsOn: ["post.sysinfo"], priority: 25 },

      // Escalation
      { key: "post.choose_vector", title: "Choose privesc vector", type: "judgment", description: "Evaluate sudo/SUID/cron/writable findings. Use GTFOBins for SUID/sudo exploits. Prefer reliable methods over kernel exploits.", dependsOn: ["post.sudo", "post.suid", "post.cron", "post.writable", "post.configs"], priority: 30 },
      { key: "post.escalate", title: "Escalate to root", type: "judgment", description: "Execute the chosen privesc vector. Capture evidence of root access.", dependsOn: ["post.choose_vector"], priority: 35 },
      { key: "post.root_flag", title: "Capture root flag", type: "mechanical", command: "pk exec -- cat /root/root.txt || find / -name root.txt 2>/dev/null", dependsOn: ["post.escalate"], priority: 40 },

      { key: "post.end", title: "Post-Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["post.root_flag"], priority: 99 },
    ],
  },
  {
    phase: "report",
    title: "Reporting",
    steps: [
      { key: "report.start", title: "Start Reporting", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "report.verify_evidence", title: "Verify evidence coverage", type: "judgment", description: "Each confirmed finding needs at least one evidence item. Each flag needs a capture record.", dependsOn: ["report.start"], priority: 10 },
      { key: "report.classify", title: "Classify and tag findings", type: "judgment", description: "Add CWE, CVSS vectors, OWASP references to each finding.", dependsOn: ["report.verify_evidence"], priority: 20 },
      { key: "report.generate", title: "Generate report", type: "mechanical", command: "pk report generate", dependsOn: ["report.classify"], priority: 30 },
      { key: "report.end", title: "Engagement Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["report.generate"], priority: 99 },
    ],
  },
];

export const BLACKBOX_PLAYBOOK: PlaybookPhaseTemplate[] = [
  {
    phase: "recon",
    title: "Reconnaissance",
    steps: [
      { key: "recon.start", title: "Start Recon", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "recon.passive", title: "Passive OSINT", type: "judgment", description: "DNS records, WHOIS, certificate transparency, Shodan, wayback machine. No direct contact.", dependsOn: ["recon.start"], priority: 5 },
      { key: "recon.dns", title: "DNS enumeration", type: "mechanical", command: "pk exec -- dig {target} ANY && dig {target} AXFR", dependsOn: ["recon.start"], priority: 10 },
      { key: "recon.port_scan", title: "Full port scan", type: "mechanical", command: "pk exec -- rustscan -a {target} -- -sV -sC", dependsOn: ["recon.passive"], priority: 15 },
      { key: "recon.waf", title: "WAF detection", type: "mechanical", command: "pk exec -- wafw00f {target}", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 20 },
      { key: "recon.tech", title: "Tech stack fingerprint", type: "mechanical", command: "pk exec -- whatweb {target}", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 20 },
      { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.waf", "recon.tech", "recon.dns"], priority: 99 },
    ],
  },
  {
    phase: "enum",
    title: "Enumeration",
    steps: [
      { key: "enum.start", title: "Start Enumeration", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "enum.dir_fuzz", title: "Directory fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{target}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt -mc 200,301,302,403", dependsOn: ["enum.start"], condition: "ports.service contains http", priority: 10 },
      { key: "enum.api", title: "API discovery", type: "judgment", description: "Check /api, /swagger, /openapi, /graphql, /.well-known. Look for version endpoints.", dependsOn: ["enum.start"], condition: "ports.service contains http", priority: 15 },
      { key: "enum.auth", title: "Authentication testing", type: "judgment", description: "Test login forms, password reset, session handling, JWT/cookie security.", dependsOn: ["enum.dir_fuzz"], priority: 20 },
      { key: "enum.nuclei", title: "Vulnerability scan", type: "mechanical", command: "pk exec -- nuclei -u {target} -tags cve,misconfig,exposure", dependsOn: ["enum.dir_fuzz"], priority: 25 },
      { key: "enum.smb", title: "SMB/LDAP enumeration", type: "mechanical", command: "pk exec -- enum4linux -a {target}", dependsOn: ["enum.start"], condition: "ports.port in [139,445,389]", priority: 10 },
      { key: "enum.end", title: "Enumeration Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["enum.auth", "enum.nuclei", "enum.smb", "enum.api"], priority: 99 },
    ],
  },
  {
    phase: "exploit",
    title: "Exploitation",
    steps: [
      { key: "exploit.start", title: "Start Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "exploit.validate", title: "Validate findings", type: "judgment", description: "Adversarial verification of each finding. Assume wrong until proven.", dependsOn: ["exploit.start"], priority: 10 },
      { key: "exploit.impact", title: "Demonstrate impact", type: "judgment", description: "Show data access, lateral movement potential. Stay within RoE.", dependsOn: ["exploit.validate"], priority: 20 },
      { key: "exploit.end", title: "Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["exploit.impact"], priority: 99 },
    ],
  },
  {
    phase: "report",
    title: "Reporting",
    steps: [
      { key: "report.start", title: "Start Reporting", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "report.evidence", title: "Verify evidence", type: "judgment", dependsOn: ["report.start"], priority: 10 },
      { key: "report.classify", title: "Classify findings", type: "judgment", dependsOn: ["report.evidence"], priority: 20 },
      { key: "report.generate", title: "Generate report", type: "mechanical", command: "pk report generate", dependsOn: ["report.classify"], priority: 30 },
      { key: "report.end", title: "Engagement Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["report.generate"], priority: 99 },
    ],
  },
];

export type PlaybookPhase = PlaybookPhaseTemplate;

export const DEFAULT_PLAYBOOKS: Record<string, { name: string; description: string; phases: PlaybookPhaseTemplate[] }> = {
  ctf: {
    name: "CTF Default",
    description: "Capture-the-flag: scan, enumerate per service, exploit, escalate, capture flags.",
    phases: CTF_PLAYBOOK,
  },
  blackbox: {
    name: "Blackbox Default",
    description: "External assessment with OSINT, scanning, enumeration, exploitation within RoE.",
    phases: BLACKBOX_PLAYBOOK,
  },
  whitebox: {
    name: "Whitebox Default",
    description: "Assessment with source access. Same as blackbox plus code review.",
    phases: BLACKBOX_PLAYBOOK,
  },
  bugbounty: {
    name: "Bug Bounty Default",
    description: "Bug bounty program. Focus on web vulns, stay in scope.",
    phases: BLACKBOX_PLAYBOOK,
  },
};
