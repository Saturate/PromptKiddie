/**
 * Default playbook templates. CTF only for now - others will be added
 * once the CTF flow is proven and tuned.
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
      { key: "recon.port_scan", title: "Full port scan", type: "mechanical", command: "pk exec -- rustscan -a {target} -- -sV", dependsOn: ["recon.start"], priority: 5 },
      { key: "recon.nmap_svc", title: "Nmap service + script scan", type: "mechanical", command: "pk exec -- nmap -sV -sC -p {ports} {target}", dependsOn: ["recon.port_scan"], priority: 10 },
      { key: "recon.web", title: "Web Recon", type: "mechanical", nodeType: "block_ref", blockRef: "Web Recon", dependsOn: ["recon.port_scan"], condition: "ports.service contains http", priority: 10 },
      { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.nmap_svc", "recon.web"], priority: 99 },
    ],
  },
  {
    phase: "enum",
    title: "Enumeration",
    steps: [
      { key: "enum.start", title: "Start Enumeration", type: "mechanical", nodeType: "sequence", priority: 0 },

      // Universal checks for every discovered service
      { key: "enum.fork", title: "Per-service checks", type: "mechanical", nodeType: "parallel", dependsOn: ["enum.start"], priority: 3 },
      { key: "enum.known_cves", title: "Search CVEs per service version", type: "judgment", description: "For each service+version: search searchsploit, NVD, exploit-db for known CVEs.", dependsOn: ["enum.fork"], priority: 5 },
      { key: "enum.default_creds", title: "Try default/anonymous access", type: "judgment", description: "For each service: try anonymous access and default credentials.", dependsOn: ["enum.fork"], priority: 5 },
      { key: "enum.nuclei", title: "Nuclei CVE + misconfig scan", type: "mechanical", command: "pk exec -- nuclei -u http://{target} -tags cve,misconfig,exposure,default-login", dependsOn: ["enum.fork"], condition: "ports.service contains http", priority: 10 },

      // Web-specific deep dive
      { key: "enum.web_content", title: "Directory fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{target}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -mc 200,301,302,403", dependsOn: ["enum.default_creds"], condition: "ports.service contains http", priority: 15 },
      { key: "enum.web_source", title: "Analyze web pages + source", type: "judgment", description: "Check robots.txt, sitemap, page source for comments, hidden forms, JS, API endpoints.", dependsOn: ["enum.web_content"], priority: 20 },

      // SMB/FTP if present
      { key: "enum.smb", title: "SMB shares + users", type: "mechanical", command: "pk exec -- enum4linux -a {target}", dependsOn: ["enum.default_creds"], condition: "ports.port in [139,445]", priority: 15 },
      { key: "enum.ftp", title: "FTP file listing + download", type: "judgment", description: "List FTP contents, download configs/backups/source code.", dependsOn: ["enum.default_creds"], condition: "ports.port = 21", priority: 15 },

      // Converge
      { key: "enum.join", title: "Consolidate findings", type: "mechanical", nodeType: "parallel", dependsOn: ["enum.known_cves", "enum.nuclei", "enum.web_source", "enum.smb", "enum.ftp"], priority: 35 },
      { key: "enum.harvest", title: "Harvest credentials + loot", type: "judgment", description: "Collect all credentials, keys, passwords, hashes found. Record each as an artifact.", dependsOn: ["enum.join"], priority: 40 },

      { key: "enum.end", title: "Enumeration Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["enum.harvest"], priority: 99 },
    ],
  },
  {
    phase: "exploit",
    title: "Exploitation",
    steps: [
      { key: "exploit.start", title: "Start Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "exploit.pick", title: "Pick best attack path", type: "judgment", description: "Review findings by priority. Pick the highest-severity, most exploitable finding.", dependsOn: ["exploit.start"], priority: 5 },
      { key: "exploit.poc", title: "Build minimal PoC", type: "judgment", description: "Create the simplest proof that works. Read-only over destructive.", dependsOn: ["exploit.pick"], priority: 10 },
      { key: "exploit.verify", title: "Adversarial verify", type: "judgment", description: "Try to disprove the finding. Check for WAF, input validation, mitigations.", dependsOn: ["exploit.poc"], priority: 15 },
      { key: "exploit.shell", title: "Get initial access", type: "judgment", description: "Use the confirmed finding to get a shell or session.", dependsOn: ["exploit.verify"], priority: 20 },
      { key: "exploit.user_flag", title: "Capture user flag", type: "mechanical", command: "pk exec -- cat /home/*/user.txt || find / -name user.txt 2>/dev/null", dependsOn: ["exploit.shell"], priority: 25 },
      { key: "exploit.end", title: "Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["exploit.user_flag"], priority: 99 },
    ],
  },
  {
    phase: "postexploit",
    title: "Post-Exploitation",
    steps: [
      { key: "post.start", title: "Start Post-Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "post.sysinfo", title: "System info", type: "mechanical", command: "pk exec -- id && whoami && uname -a && hostname", dependsOn: ["post.start"], priority: 5 },

      // Parallel privesc checks
      { key: "post.fork", title: "Privesc checks", type: "mechanical", nodeType: "parallel", dependsOn: ["post.sysinfo"], priority: 8 },
      { key: "post.sudo", title: "sudo -l", type: "mechanical", command: "pk exec -- sudo -l 2>/dev/null", dependsOn: ["post.fork"], priority: 10 },
      { key: "post.suid", title: "SUID binaries", type: "mechanical", command: "pk exec -- find / -perm -4000 -type f 2>/dev/null", dependsOn: ["post.fork"], priority: 10 },
      { key: "post.cron", title: "Cron jobs", type: "mechanical", command: "pk exec -- cat /etc/crontab && ls -la /etc/cron.* 2>/dev/null", dependsOn: ["post.fork"], priority: 15 },
      { key: "post.configs", title: "Credentials in files", type: "mechanical", command: "pk exec -- find / -name '*.conf' -o -name '.env' -o -name 'wp-config*' 2>/dev/null | head -20", dependsOn: ["post.fork"], priority: 15 },

      { key: "post.join", title: "Evaluate vectors", type: "mechanical", nodeType: "parallel", dependsOn: ["post.sudo", "post.suid", "post.cron", "post.configs"], priority: 25 },
      { key: "post.escalate", title: "Escalate to root", type: "judgment", description: "Use GTFOBins for SUID/sudo. Prefer reliable over kernel exploits.", dependsOn: ["post.join"], priority: 30 },
      { key: "post.root_flag", title: "Capture root flag", type: "mechanical", command: "pk exec -- cat /root/root.txt || find / -name root.txt 2>/dev/null", dependsOn: ["post.escalate"], priority: 35 },
      { key: "post.end", title: "Post-Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["post.root_flag"], priority: 99 },
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
