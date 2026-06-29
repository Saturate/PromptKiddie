/**
 * Default playbook templates per engagement type.
 * Seeded on first run. Users can customize or create their own.
 */
import type { PlaybookPhase } from "./schema.js";

export const CTF_PLAYBOOK: PlaybookPhase[] = [
  {
    phase: "recon",
    title: "Reconnaissance",
    steps: [
      {
        key: "recon.full_port_scan",
        title: "Full port scan",
        type: "mechanical",
        command: "pk exec -- rustscan -a {target} -- -sV -sC",
        description: "Discover all open ports and identify services. Results auto-populate the ports table.",
      },
      {
        key: "recon.service_versions",
        title: "Service version detection",
        type: "mechanical",
        command: "pk exec -- nmap -sV -sC -p {ports} {target}",
        description: "Detailed service/version scan on discovered open ports.",
        dependsOn: ["recon.full_port_scan"],
        condition: "ports.count > 0",
      },
      {
        key: "recon.web_tech",
        title: "Web technology fingerprint",
        type: "mechanical",
        command: "pk exec -- whatweb {target}:{port}",
        description: "Identify CMS, frameworks, server software on HTTP services.",
        dependsOn: ["recon.service_versions"],
        condition: "ports.service contains http",
      },
      {
        key: "recon.check_robots",
        title: "Check robots.txt and common files",
        type: "mechanical",
        command: "pk exec -- curl -s {target}/robots.txt",
        dependsOn: ["recon.service_versions"],
        condition: "ports.service contains http",
      },
      {
        key: "recon.view_source",
        title: "View page source for comments/hints",
        type: "judgment",
        description: "Check HTML source for hidden comments, JS files, API endpoints, version info.",
        dependsOn: ["recon.service_versions"],
        condition: "ports.service contains http",
      },
    ],
  },
  {
    phase: "enum",
    title: "Enumeration",
    steps: [
      {
        key: "enum.dir_fuzz",
        title: "Directory fuzzing",
        type: "mechanical",
        command: "pk exec -- ffuf -u http://{target}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -mc 200,301,302,403",
        description: "Discover hidden directories and files on each HTTP service.",
        condition: "ports.service contains http",
      },
      {
        key: "enum.subdomain_fuzz",
        title: "Subdomain/vhost fuzzing",
        type: "mechanical",
        command: "pk exec -- ffuf -u http://{target} -H 'Host: FUZZ.{target}' -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -mc 200,301,302",
        dependsOn: ["enum.dir_fuzz"],
        condition: "ports.service contains http",
        optional: true,
      },
      {
        key: "enum.smb_enum",
        title: "SMB enumeration",
        type: "mechanical",
        command: "pk exec -- enum4linux -a {target}",
        description: "Enumerate users, shares, groups from SMB/NetBIOS.",
        condition: "ports.service contains smb or ports.port in [139,445]",
      },
      {
        key: "enum.ftp_anon",
        title: "Check FTP anonymous login",
        type: "mechanical",
        command: "pk exec -- curl -s ftp://{target}/",
        condition: "ports.port = 21",
      },
      {
        key: "enum.ssh_version",
        title: "Note SSH version for known vulns",
        type: "judgment",
        description: "Check if the SSH version has known CVEs (e.g. user enumeration in OpenSSH < 7.7).",
        condition: "ports.port = 22",
      },
      {
        key: "enum.vuln_scan",
        title: "Vulnerability scan",
        type: "mechanical",
        command: "pk exec -- nuclei -u http://{target}:{port} -tags cve,misconfig",
        description: "Run nuclei templates against discovered services.",
        dependsOn: ["enum.dir_fuzz"],
        condition: "ports.service contains http",
      },
      {
        key: "enum.default_creds",
        title: "Try default credentials",
        type: "judgment",
        description: "Check for default/common credentials on login forms, SSH, FTP, databases. Research the specific service.",
        dependsOn: ["enum.vuln_scan"],
      },
    ],
  },
  {
    phase: "exploit",
    title: "Exploitation",
    steps: [
      {
        key: "exploit.validate_findings",
        title: "Validate triage findings",
        type: "judgment",
        description: "For each triage finding, build a minimal PoC that proves the vulnerability. Promote to confirmed or reject as false positive.",
      },
      {
        key: "exploit.initial_access",
        title: "Gain initial access",
        type: "judgment",
        description: "Use a confirmed finding to get a shell or authenticated session. Prefer the lowest-impact path.",
        dependsOn: ["exploit.validate_findings"],
      },
      {
        key: "exploit.capture_user_flag",
        title: "Capture user flag",
        type: "mechanical",
        command: "pk exec -- cat /home/*/user.txt",
        description: "Read the user flag. Common locations: /home/*/user.txt, ~/flag.txt, desktop.",
        dependsOn: ["exploit.initial_access"],
        optional: true,
      },
    ],
  },
  {
    phase: "postexploit",
    title: "Post-Exploitation",
    steps: [
      {
        key: "postexploit.local_enum",
        title: "Local enumeration",
        type: "mechanical",
        command: "pk exec -- id && whoami && uname -a && cat /etc/os-release",
        description: "Gather system info: user, groups, OS, kernel version.",
      },
      {
        key: "postexploit.privesc_check",
        title: "Privilege escalation vectors",
        type: "judgment",
        description: "Check SUID binaries, sudo -l, cron jobs, writable paths, kernel exploits, service misconfigs. Use GTFOBins for SUID/sudo exploits.",
        dependsOn: ["postexploit.local_enum"],
      },
      {
        key: "postexploit.escalate",
        title: "Escalate privileges",
        type: "judgment",
        description: "Exploit the identified privesc vector to get root/admin.",
        dependsOn: ["postexploit.privesc_check"],
      },
      {
        key: "postexploit.capture_root_flag",
        title: "Capture root flag",
        type: "mechanical",
        command: "pk exec -- cat /root/root.txt",
        description: "Read the root flag.",
        dependsOn: ["postexploit.escalate"],
        optional: true,
      },
    ],
  },
  {
    phase: "report",
    title: "Reporting",
    steps: [
      {
        key: "report.verify_findings",
        title: "Verify all findings have evidence",
        type: "judgment",
        description: "Each confirmed finding should have at least one piece of evidence (screenshot, output, file).",
      },
      {
        key: "report.generate",
        title: "Generate report",
        type: "mechanical",
        command: "pk report generate",
        description: "Produce the PDF deliverable from DB state.",
      },
    ],
  },
];

export const BLACKBOX_PLAYBOOK: PlaybookPhase[] = [
  {
    phase: "recon",
    title: "Reconnaissance",
    steps: [
      {
        key: "recon.passive_osint",
        title: "Passive OSINT",
        type: "judgment",
        description: "DNS records, WHOIS, certificate transparency, Shodan, wayback machine. No direct target contact.",
      },
      {
        key: "recon.subdomain_enum",
        title: "Subdomain enumeration",
        type: "mechanical",
        command: "pk exec -- dig {target} ANY && pk exec -- whois {target}",
      },
      {
        key: "recon.full_port_scan",
        title: "Full port scan",
        type: "mechanical",
        command: "pk exec -- rustscan -a {target} -- -sV -sC",
      },
      {
        key: "recon.web_tech",
        title: "Web technology fingerprint",
        type: "mechanical",
        command: "pk exec -- whatweb {target} && pk exec -- wafw00f {target}",
        condition: "ports.service contains http",
      },
    ],
  },
  {
    phase: "enum",
    title: "Enumeration",
    steps: [
      {
        key: "enum.dir_fuzz",
        title: "Directory fuzzing (all HTTP services)",
        type: "mechanical",
        command: "pk exec -- ffuf -u http://{target}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt -mc 200,301,302,403",
        condition: "ports.service contains http",
      },
      {
        key: "enum.api_discovery",
        title: "API endpoint discovery",
        type: "judgment",
        description: "Check /api, /swagger, /openapi, /graphql. Look for version endpoints, health checks, debug routes.",
        condition: "ports.service contains http",
      },
      {
        key: "enum.auth_testing",
        title: "Authentication testing",
        type: "judgment",
        description: "Test login forms for SQLi, default creds, brute force (within RoE). Check password reset flows, session handling.",
      },
      {
        key: "enum.smb_ldap",
        title: "SMB/LDAP enumeration",
        type: "mechanical",
        command: "pk exec -- enum4linux -a {target}",
        condition: "ports.port in [139,445,389,636]",
      },
      {
        key: "enum.vuln_scan",
        title: "Targeted vulnerability scan",
        type: "mechanical",
        command: "pk exec -- nuclei -u {target} -tags cve,misconfig,exposure",
      },
    ],
  },
  {
    phase: "exploit",
    title: "Exploitation",
    steps: [
      {
        key: "exploit.validate",
        title: "Validate and verify findings",
        type: "judgment",
        description: "Build minimal PoCs for each triage finding. Adversarial verification: assume wrong until proven.",
      },
      {
        key: "exploit.demonstrate_impact",
        title: "Demonstrate impact",
        type: "judgment",
        description: "Show what an attacker could achieve: data access, lateral movement, privilege escalation. Stay within RoE.",
      },
    ],
  },
  {
    phase: "postexploit",
    title: "Post-Exploitation",
    steps: [
      {
        key: "postexploit.lateral",
        title: "Lateral movement (if in scope)",
        type: "judgment",
        description: "Use captured credentials/sessions to access other systems. Check RoE before proceeding.",
      },
      {
        key: "postexploit.data_access",
        title: "Demonstrate data access",
        type: "judgment",
        description: "Show what sensitive data is reachable from the compromised position. Capture evidence, don't exfiltrate.",
      },
    ],
  },
  {
    phase: "report",
    title: "Reporting",
    steps: [
      {
        key: "report.verify_evidence",
        title: "Verify all findings have evidence",
        type: "judgment",
      },
      {
        key: "report.generate",
        title: "Generate report",
        type: "mechanical",
        command: "pk report generate",
      },
    ],
  },
];

export const DEFAULT_PLAYBOOKS: Record<string, { name: string; description: string; phases: PlaybookPhase[] }> = {
  ctf: {
    name: "CTF Default",
    description: "Capture-the-flag playbook. Scan, enumerate, exploit, escalate, capture flags.",
    phases: CTF_PLAYBOOK,
  },
  blackbox: {
    name: "Blackbox Default",
    description: "External assessment. OSINT, scanning, enumeration, exploitation within RoE.",
    phases: BLACKBOX_PLAYBOOK,
  },
  whitebox: {
    name: "Whitebox Default",
    description: "Assessment with source access. Same as blackbox plus code review steps.",
    phases: BLACKBOX_PLAYBOOK,
  },
  bugbounty: {
    name: "Bug Bounty Default",
    description: "Bug bounty program. Focus on web vulns, stay in scope, report clearly.",
    phases: BLACKBOX_PLAYBOOK,
  },
};
