import type { PlaybookPhaseTemplate, PlaybookDef } from "./types.js";

const phases: PlaybookPhaseTemplate[] = [
  {
    phase: "recon",
    title: "Reconnaissance",
    steps: [
      { key: "recon.start", title: "Start Recon", type: "mechanical", nodeType: "sequence", priority: 0 },

      { key: "recon.tcp_scan", title: "TCP port scan (all ports)", type: "mechanical", command: "pk exec -- rustscan -a {target}", dependsOn: ["recon.start"], priority: 5 },
      { key: "recon.udp_scan", title: "UDP top ports scan", type: "mechanical", command: "pk exec -- nmap -sU --top-ports 20 --open {target}", dependsOn: ["recon.start"], priority: 8 },

      { key: "recon.nmap_svc", title: "Nmap service + script scan", type: "mechanical", command: "pk exec -- nmap -sV -sC -p {ports} {target}", dependsOn: ["recon.tcp_scan"], priority: 10 },

      { key: "recon.web", title: "Web Recon", type: "mechanical", nodeType: "block_ref", blockRef: "Web Recon", dependsOn: ["recon.nmap_svc"], condition: "ports.service contains http", priority: 12 },
      { key: "recon.ssl_names", title: "Extract hostnames from SSL certs", type: "mechanical", command: "pk exec -- echo | openssl s_client -connect {target}:443 2>/dev/null | openssl x509 -noout -ext subjectAltName -subject 2>/dev/null || echo 'no SSL'", dependsOn: ["recon.nmap_svc"], condition: "ports.port in [443,8443,9443]", priority: 12 },

      { key: "recon.clock_skew", title: "Check clock skew", type: "judgment", command: "pk exec -- nmap -sV -p 88 {target} --script krb5-enum-users 2>/dev/null; pk exec -- ntpdate -q {target} 2>/dev/null || echo 'ntpdate not available'", dependsOn: ["recon.nmap_svc"], condition: "ports.port in [88,389,636]", priority: 15, description: "Check clock skew with nmap/ntpdate. If >5 min offset, note it and ensure faketime is available for Kerberos tools (certipy, impacket). Record the offset for later use.", optional: true },

      { key: "recon.freestyle", title: "Additional recon", type: "judgment", description: "Anything the playbook missed: unusual services, non-standard ports, passive OSINT. If you find a technique that works, note it for playbook improvement.", dependsOn: ["recon.nmap_svc", "recon.web", "recon.udp_scan", "recon.ssl_names", "recon.clock_skew"], priority: 90, optional: true },
      { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.nmap_svc", "recon.web", "recon.udp_scan", "recon.ssl_names", "recon.clock_skew", "recon.freestyle"], priority: 99 },
    ],
  },
  {
    phase: "enum",
    title: "Enumeration",
    steps: [
      { key: "enum.start", title: "Start Enumeration", type: "mechanical", nodeType: "sequence", priority: 0 },

      { key: "enum.hosts_file", title: "Add target to /etc/hosts", type: "judgment", description: "Add the target hostname to /etc/hosts if the box has a domain name (from SSL certs, nmap scripts, or room description). Required for vhosts and web apps.", dependsOn: ["enum.start"], priority: 2 },

      { key: "enum.fork", title: "Per-service checks", type: "mechanical", nodeType: "parallel", dependsOn: ["enum.hosts_file"], priority: 5 },
      { key: "enum.known_cves", title: "Search CVEs per service version", type: "judgment", description: "For each service+version: search searchsploit, NVD, exploit-db for known CVEs.", dependsOn: ["enum.fork"], priority: 8 },
      { key: "enum.default_creds", title: "Try default/anonymous access", type: "judgment", description: "For each service: try anonymous access (FTP, SMB null session) and default credentials (admin:admin, root:root, service-specific).", dependsOn: ["enum.fork"], priority: 8 },

      { key: "enum.dir_fuzz", title: "Directory + extension fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{target}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/directory-list-2.3-medium.txt -mc 200,301,302,403 -e .php,.html,.txt,.bak,.old -fc 404", dependsOn: ["enum.fork"], condition: "ports.service contains http", priority: 10 },
      { key: "enum.nuclei", title: "Nuclei CVE + misconfig scan", type: "mechanical", command: "pk exec -- nuclei -u {target} -tags cve,misconfig,exposure,default-login -severity medium,high,critical", dependsOn: ["enum.fork"], condition: "ports.service contains http", priority: 10 },
      { key: "enum.vhost_fuzz", title: "Vhost/subdomain fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{target} -H 'Host: FUZZ.{target}' -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -mc 200,301,302 -fs 0", dependsOn: ["enum.fork"], condition: "ports.service contains http", priority: 12, optional: true },
      { key: "enum.web_source", title: "Analyze web pages + source", type: "judgment", description: "Check robots.txt, sitemap, page source for comments, hidden forms, JS, API endpoints. Look for injection entry points.", dependsOn: ["enum.dir_fuzz"], priority: 15 },

      { key: "enum.sqli_test", title: "Test for SQL injection", type: "judgment", description: "Test login forms and URL parameters for SQLi. Try manual payloads first, then sqlmap if promising.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 18 },
      { key: "enum.lfi_test", title: "Test for LFI/RFI", type: "judgment", description: "Test file parameters for local/remote file inclusion: ../../etc/passwd, php://filter, etc.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 18 },
      { key: "enum.ssti_test", title: "Test for SSTI", type: "judgment", description: "Test for SSTI: {{7*7}}, ${7*7}, #{7*7} in all input fields. Check Jinja2, Twig, Mako, Pebble.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 18 },
      { key: "enum.cmdi_test", title: "Test for command injection", type: "judgment", description: "Test parameters for OS command injection: ; id, | whoami, $(id), `id`. Check ping, traceroute, and lookup fields.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 18 },
      { key: "enum.xxe_test", title: "Test for XXE", type: "judgment", description: "Test XML-accepting endpoints for XXE: file:///etc/passwd, SSRF via DTD. Check file upload, SOAP, RSS endpoints.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 19 },
      { key: "enum.ssrf_test", title: "Test for SSRF", type: "judgment", description: "Test URL/redirect parameters for SSRF: http://127.0.0.1, http://169.254.169.254, internal services on discovered ports.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 19 },
      { key: "enum.upload_test", title: "Test file upload bypass", type: "judgment", description: "Test file upload for bypass: double extensions (.php.jpg), null bytes, content-type manipulation, magic bytes.", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 19, optional: true },

      { key: "enum.path_traversal", title: "Path Traversal Testing", type: "judgment", nodeType: "block_ref", blockRef: "Path Traversal Testing", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 18, description: "For file download/upload/read endpoints: test path traversal with plain, single-encoded, double-encoded, unicode, and null byte payloads." },
      { key: "enum.web_attack_surface", title: "Web Attack Surface", type: "judgment", nodeType: "block_ref", blockRef: "Web Attack Surface", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 19, optional: true, description: "Systematic web app testing: IDOR, auth bypass, error disclosure. Run after finding authenticated endpoints or file operations." },

      { key: "enum.smb", title: "SMB shares + users", type: "mechanical", command: "pk exec -- enum4linux -a {target}", dependsOn: ["enum.default_creds"], condition: "ports.port in [139,445]", priority: 12 },
      { key: "enum.ftp", title: "FTP file listing + download", type: "judgment", description: "List FTP contents, download configs/backups/source code.", dependsOn: ["enum.default_creds"], condition: "ports.port = 21", priority: 12 },
      { key: "enum.snmp", title: "SNMP enumeration", type: "mechanical", command: "pk exec -- snmpwalk -v2c -c public {target} 2>/dev/null | head -50", dependsOn: ["enum.fork"], condition: "ports.port in [161]", priority: 12 },

      { key: "enum.cewl", title: "Generate wordlist from site", type: "mechanical", command: "pk exec -- cewl http://{target} -d 2 -m 5 -w /tmp/cewl.txt", dependsOn: ["enum.web_source"], condition: "ports.service contains http", priority: 20, optional: true },
      { key: "enum.brute_force", title: "Brute-force / password spray", type: "judgment", description: "Use hydra or ffuf against login forms with cewl wordlist and common passwords. Try top usernames: admin, root, user.", dependsOn: ["enum.cewl", "enum.default_creds"], condition: "ports.service contains http", priority: 22 },
      { key: "enum.harvest", title: "Harvest credentials + loot", type: "judgment", description: "Collect all credentials, keys, passwords, hashes found. Record each as an artifact.", dependsOn: ["enum.known_cves", "enum.default_creds", "enum.nuclei", "enum.web_source", "enum.smb", "enum.ftp", "enum.snmp", "enum.sqli_test", "enum.lfi_test", "enum.ssti_test", "enum.cmdi_test", "enum.xxe_test", "enum.ssrf_test", "enum.upload_test", "enum.path_traversal", "enum.web_attack_surface", "enum.brute_force", "enum.vhost_fuzz"], priority: 30 },

      { key: "enum.freestyle", title: "Additional enumeration", type: "judgment", description: "Services or protocols not covered above: Redis, Memcached, LDAP, databases, custom APIs, unusual web frameworks. If you find a technique that works, note it for playbook improvement.", dependsOn: ["enum.harvest"], priority: 90, optional: true },
      { key: "enum.end", title: "Enumeration Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["enum.harvest", "enum.freestyle"], priority: 99 },
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
      { key: "exploit.user_flag", title: "Capture user flag", type: "mechanical", command: "pk exec -- find / -name user.txt 2>/dev/null | head -5 && cat /home/*/user.txt 2>/dev/null || dir C:\\Users\\*\\Desktop\\user.txt 2>nul", dependsOn: ["exploit.shell"], priority: 25 },
      { key: "exploit.freestyle", title: "Alternative attack paths", type: "judgment", description: "If the primary path failed or the user flag wasn't found: try a different finding, chain exploits, or attempt an approach not covered by the playbook. Note successful techniques for playbook improvement.", dependsOn: ["exploit.user_flag"], priority: 90, optional: true },
      { key: "exploit.end", title: "Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["exploit.user_flag", "exploit.freestyle"], priority: 99 },
    ],
  },
  {
    phase: "postexploit",
    title: "Post-Exploitation",
    steps: [
      { key: "post.start", title: "Start Post-Exploitation", type: "mechanical", nodeType: "sequence", priority: 0 },
      { key: "post.sysinfo", title: "System info", type: "mechanical", command: "pk exec -- id && whoami && uname -a && hostname && cat /etc/os-release 2>/dev/null", dependsOn: ["post.start"], priority: 5 },
      { key: "post.local_creds", title: "Harvest local credentials", type: "judgment", description: "Check bash_history, .ssh/*, database configs (wp-config.php, .env), browser saved passwords, /etc/shadow if readable.", dependsOn: ["post.sysinfo"], priority: 8 },
      { key: "post.win_forensics", title: "Windows Forensics", type: "judgment", nodeType: "block_ref", blockRef: "Windows Forensics", dependsOn: ["post.local_creds"], condition: "targets.os contains windows", priority: 9, optional: true, description: "After gaining file read on Windows: download ntuser.dat, registry hives, check credential stores (KeePass, browser profiles, SSH keys)." },
      { key: "post.internal_net", title: "Internal network recon", type: "mechanical", command: "pk exec -- ip addr && ip route && arp -a && ss -tlnp", dependsOn: ["post.sysinfo"], priority: 10 },
      { key: "post.privesc", title: "Privilege Escalation", type: "mechanical", nodeType: "block_ref", blockRef: "Privilege Escalation", dependsOn: ["post.local_creds"], priority: 12 },
      { key: "post.lateral", title: "Lateral Movement", type: "judgment", nodeType: "block_ref", blockRef: "Lateral Movement", dependsOn: ["post.privesc"], priority: 13, optional: true, description: "If multiple users or hosts are in scope, enumerate and pivot through each. Repeat the block for each hop." },
      { key: "post.crack", title: "Credential Cracking", type: "mechanical", nodeType: "block_ref", blockRef: "Credential Cracking", dependsOn: ["post.local_creds"], condition: "artifacts.type == credential", priority: 14, optional: true },
      { key: "post.adcs_esc", title: "ADCS ESC relay", type: "judgment", dependsOn: ["post.privesc"], condition: "ports.port in [88,389,636]", priority: 30, optional: true, description: "If ADCS is present: check for ESC1-ESC11. For relay attacks (ESC8/ESC11): run the relay server on the ATTACKBOX (privileged ports), coerce the target to connect to the attackbox, relay outbound through SOCKS to the CA. Do NOT run relay on the pivot host." },
      { key: "post.root_flag", title: "Capture root flag", type: "mechanical", command: "pk exec -- find / -name root.txt 2>/dev/null | head -5 && cat /root/root.txt 2>/dev/null || dir C:\\Users\\Administrator\\Desktop\\root.txt 2>nul", dependsOn: ["post.privesc", "post.lateral", "post.adcs_esc"], priority: 35 },
      { key: "post.freestyle", title: "Additional post-exploitation", type: "judgment", description: "Anything the playbook missed: persistence mechanisms, data exfiltration paths, additional flags, pivoting to other hosts. Note successful techniques for playbook improvement.", dependsOn: ["post.root_flag", "post.internal_net", "post.crack", "post.lateral", "post.adcs_esc", "post.win_forensics"], priority: 90, optional: true },
      { key: "post.end", title: "Post-Exploitation Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["post.root_flag", "post.internal_net", "post.crack", "post.lateral", "post.adcs_esc", "post.win_forensics", "post.freestyle"], priority: 99 },
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

export const CTF_PLAYBOOK: PlaybookDef = {
  name: "CTF Default",
  description: "Capture-the-flag: scan, enumerate per service, exploit, escalate, capture flags.",
  phases,
};
