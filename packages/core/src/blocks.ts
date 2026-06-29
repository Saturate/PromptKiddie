/**
 * Built-in reusable blocks for graph playbooks.
 * Each block is a self-contained sub-graph with typed inputs/outputs.
 */
import type { PlaybookStep } from "./schema.js";

export interface BlockDef {
  name: string;
  description: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  nodes: PlaybookStep[];
}

export const HTTP_ENUM_BLOCK: BlockDef = {
  name: "HTTP Enumeration",
  description: "Standard web service enumeration: robots.txt, directory fuzzing, source analysis, tech fingerprint.",
  inputSchema: { host: "string", port: "number" },
  outputSchema: { directories: "string[]", findings: "Finding[]" },
  nodes: [
    { key: "http.robots", title: "Check robots.txt", type: "mechanical", command: "pk exec -- curl -s http://{host}:{port}/robots.txt", priority: 10 },
    { key: "http.source", title: "View page source", type: "judgment", description: "Check HTML source for comments, JS files, API endpoints, version info.", priority: 20 },
    { key: "http.tech", title: "Technology fingerprint", type: "mechanical", command: "pk exec -- whatweb http://{host}:{port}", priority: 15 },
    { key: "http.dir_fuzz", title: "Directory fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{host}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -mc 200,301,302,403", priority: 30, dependsOn: ["http.robots"] },
    { key: "http.vuln_scan", title: "Vulnerability scan", type: "mechanical", command: "pk exec -- nuclei -u http://{host}:{port} -tags cve,misconfig", priority: 40, dependsOn: ["http.tech"] },
  ],
};

export const SMB_ENUM_BLOCK: BlockDef = {
  name: "SMB Enumeration",
  description: "Windows/Samba share, user, and policy enumeration.",
  inputSchema: { host: "string" },
  outputSchema: { shares: "string[]", users: "string[]" },
  nodes: [
    { key: "smb.enum4linux", title: "enum4linux full scan", type: "mechanical", command: "pk exec -- enum4linux -a {host}", priority: 10 },
    { key: "smb.shares", title: "List SMB shares", type: "mechanical", command: "pk exec -- smbclient -L //{host} -N", priority: 20 },
    { key: "smb.null_session", title: "Test null session", type: "mechanical", command: "pk exec -- smbclient //{host}/IPC$ -N", priority: 30 },
  ],
};

export const SSH_ATTEMPT_BLOCK: BlockDef = {
  name: "SSH Access",
  description: "Check SSH version, try default/captured credentials.",
  inputSchema: { host: "string", port: "number" },
  outputSchema: { access: "boolean", user: "string" },
  nodes: [
    { key: "ssh.version", title: "Check SSH version for CVEs", type: "judgment", description: "Check if the SSH version has known vulnerabilities.", priority: 10 },
    { key: "ssh.default_creds", title: "Try default credentials", type: "judgment", description: "Try common default credentials: root:root, admin:admin, service-specific defaults.", priority: 20 },
    { key: "ssh.captured_creds", title: "Try captured credentials", type: "judgment", description: "Use any credentials found during enumeration.", condition: "artifacts.type == 'credential'", priority: 5, dependsOn: ["ssh.default_creds"] },
  ],
};

export const FTP_CHECK_BLOCK: BlockDef = {
  name: "FTP Check",
  description: "Check for anonymous FTP access and list files.",
  inputSchema: { host: "string" },
  outputSchema: { anonymous: "boolean", files: "string[]" },
  nodes: [
    { key: "ftp.anon", title: "Check anonymous login", type: "mechanical", command: "pk exec -- curl -s ftp://{host}/", priority: 10 },
    { key: "ftp.list", title: "List FTP files", type: "mechanical", command: "pk exec -- curl -s ftp://{host}/ --list-only", priority: 20, dependsOn: ["ftp.anon"] },
  ],
};

export const LINUX_PRIVESC_BLOCK: BlockDef = {
  name: "Linux Privilege Escalation",
  description: "Standard Linux privesc checks: SUID, sudo, cron, kernel.",
  inputSchema: { host: "string" },
  outputSchema: { vector: "string", root: "boolean" },
  nodes: [
    { key: "privesc.suid", title: "Find SUID binaries", type: "mechanical", command: "pk exec -- find / -perm -4000 -type f 2>/dev/null", priority: 10 },
    { key: "privesc.sudo", title: "Check sudo -l", type: "mechanical", command: "pk exec -- sudo -l", priority: 5 },
    { key: "privesc.cron", title: "Check cron jobs", type: "mechanical", command: "pk exec -- cat /etc/crontab && ls -la /etc/cron.d/", priority: 20 },
    { key: "privesc.writable", title: "Find writable paths", type: "mechanical", command: "pk exec -- find / -writable -type d 2>/dev/null | head -20", priority: 30 },
    { key: "privesc.kernel", title: "Check kernel version", type: "judgment", description: "Check kernel version against known exploits (searchsploit, GTFOBins).", priority: 40 },
    { key: "privesc.exploit", title: "Exploit privesc vector", type: "judgment", description: "Use the most promising vector. Prefer GTFOBins for SUID/sudo over kernel exploits.", dependsOn: ["privesc.suid", "privesc.sudo", "privesc.cron"], priority: 50 },
  ],
};

export const BUILTIN_BLOCKS: BlockDef[] = [
  HTTP_ENUM_BLOCK,
  SMB_ENUM_BLOCK,
  SSH_ATTEMPT_BLOCK,
  FTP_CHECK_BLOCK,
  LINUX_PRIVESC_BLOCK,
];
