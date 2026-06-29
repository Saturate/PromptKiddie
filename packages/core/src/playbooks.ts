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

      // Service identification
      { key: "recon.nmap_svc", title: "Nmap service + script scan", type: "mechanical", command: "pk exec -- nmap -sV -sC -p {ports} {target}", dependsOn: ["recon.port_scan"], priority: 10 },

      // Web recon (block reference - expands to whatweb, wafw00f, headers, favicon)
      { key: "recon.web", title: "Web Recon", type: "mechanical", nodeType: "block_ref", blockRef: "Web Recon", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 10 },

      { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.nmap_svc", "recon.web"], priority: 99 },
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

      // Service-specific deep enumeration (block references)
      { key: "enum.web", title: "HTTP Enumeration", type: "mechanical", nodeType: "block_ref", blockRef: "HTTP Enumeration", dependsOn: ["enum.default_creds"], condition: "ports.service contains http", priority: 15 },
      { key: "enum.smb", title: "SMB Enumeration", type: "mechanical", nodeType: "block_ref", blockRef: "SMB Enumeration", dependsOn: ["enum.default_creds"], condition: "ports.port in [139,445]", priority: 15 },
      { key: "enum.ftp", title: "FTP Check", type: "mechanical", nodeType: "block_ref", blockRef: "FTP Check", dependsOn: ["enum.default_creds"], condition: "ports.port = 21", priority: 15 },

      // Consolidate
      { key: "enum.harvest_creds", title: "Harvest credentials from findings", type: "judgment", description: "Collect all credentials found: default creds, keys, passwords in configs, hashes. Record each as an artifact.", dependsOn: ["enum.web", "enum.smb", "enum.ftp", "enum.known_cves", "enum.nuclei"], priority: 30 },

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

      // Privesc (block reference - expands to SUID, sudo, cron, writable, kernel, exploit)
      { key: "post.privesc", title: "Linux Privilege Escalation", type: "mechanical", nodeType: "block_ref", blockRef: "Linux Privilege Escalation", dependsOn: ["post.sysinfo"], priority: 10 },
      { key: "post.configs", title: "Search for credentials in files", type: "mechanical", command: "pk exec -- find / -name '*.conf' -o -name '*.cfg' -o -name '.env' -o -name 'wp-config*' 2>/dev/null | head -20", dependsOn: ["post.sysinfo"], priority: 15 },
      { key: "post.network", title: "Internal network recon", type: "mechanical", command: "pk exec -- ip addr && ip route && ss -tlnp", dependsOn: ["post.sysinfo"], priority: 25 },
      { key: "post.root_flag", title: "Capture root flag", type: "mechanical", command: "pk exec -- cat /root/root.txt || find / -name root.txt 2>/dev/null", dependsOn: ["post.privesc"], priority: 40 },

      { key: "post.end", title: "Post-Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["post.root_flag", "post.network"], priority: 99 },
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
      { key: "recon.passive", title: "Passive OSINT", type: "judgment", description: "Certificate transparency, Shodan, Wayback Machine, Google dorks. No direct target contact.", dependsOn: ["recon.start"], priority: 5 },
      { key: "recon.dns", title: "DNS Recon", type: "mechanical", nodeType: "block_ref", blockRef: "DNS Recon", dependsOn: ["recon.start"], priority: 8 },
      { key: "recon.port_scan", title: "Full port scan", type: "mechanical", command: "pk exec -- rustscan -a {target} -- -sV", dependsOn: ["recon.passive"], priority: 15 },
      { key: "recon.nmap_svc", title: "Nmap service detection", type: "mechanical", command: "pk exec -- nmap -sV -sC -p {ports} {target}", dependsOn: ["recon.port_scan"], priority: 18 },
      { key: "recon.web", title: "Web Recon", type: "mechanical", nodeType: "block_ref", blockRef: "Web Recon", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 18 },
      { key: "recon.ssl", title: "SSL/TLS Inspection", type: "mechanical", nodeType: "block_ref", blockRef: "SSL/TLS Inspection", dependsOn: ["recon.port_scan"], condition: "ports.port in [443,8443]", priority: 20 },
      { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.nmap_svc", "recon.web", "recon.dns", "recon.ssl"], priority: 99 },
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
