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

export const WEB_RECON_BLOCK: BlockDef = {
  name: "Web Recon",
  description: "Web service fingerprinting: tech stack, WAF, headers, favicon hash. Used in recon phase.",
  inputSchema: { host: "string", port: "number" },
  outputSchema: { tech: "string[]", waf: "string" },
  nodes: [
    { key: "web_recon.tech", title: "Web stack fingerprint (whatweb)", type: "mechanical", command: "pk exec -- whatweb http://{host}:{port} --color=never", priority: 10 },
    { key: "web_recon.waf", title: "WAF detection", type: "mechanical", command: "pk exec -- wafw00f http://{host}:{port}", priority: 12 },
    { key: "web_recon.headers", title: "HTTP header inspection", type: "mechanical", command: "pk exec -- curl -sI http://{host}:{port}", priority: 11 },
    { key: "web_recon.favicon", title: "Favicon hash lookup", type: "mechanical", command: "pk exec -- curl -s http://{host}:{port}/favicon.ico | md5sum", priority: 13 },
  ],
};

export const HTTP_ENUM_BLOCK: BlockDef = {
  name: "HTTP Enumeration",
  description: "Web content discovery, vulnerability scanning, source analysis. Used in enum phase.",
  inputSchema: { host: "string", port: "number" },
  outputSchema: { directories: "string[]", findings: "Finding[]" },
  nodes: [
    { key: "http_enum.robots", title: "Check robots.txt / sitemap", type: "mechanical", command: "pk exec -- curl -s http://{host}:{port}/robots.txt && curl -s http://{host}:{port}/sitemap.xml", priority: 8 },
    { key: "http_enum.source", title: "Analyze page source", type: "judgment", description: "Check HTML for comments, hidden forms, JS files, API endpoints, version strings.", priority: 10 },
    { key: "http_enum.dir_fuzz", title: "Directory fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{host}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt -mc 200,301,302,403", priority: 15, dependsOn: ["http_enum.robots"] },
    { key: "http_enum.nuclei", title: "Nuclei CVE + misconfig scan", type: "mechanical", command: "pk exec -- nuclei -u http://{host}:{port} -tags cve,misconfig,exposure,default-login", priority: 12 },
    { key: "http_enum.nikto", title: "Nikto vulnerability scan", type: "mechanical", command: "pk exec -- nikto -h http://{host}:{port}", priority: 25, dependsOn: ["http_enum.dir_fuzz"] },
    { key: "http_enum.default_creds", title: "Try default web app creds", type: "judgment", description: "Research the CMS/app and try default credentials.", priority: 20 },
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

export const DNS_RECON_BLOCK: BlockDef = {
  name: "DNS Recon",
  description: "DNS enumeration: records, zone transfer, subdomain brute. Used in blackbox/bugbounty recon.",
  inputSchema: { domain: "string" },
  outputSchema: { subdomains: "string[]", records: "string[]" },
  nodes: [
    { key: "dns.records", title: "DNS record lookup", type: "mechanical", command: "pk exec -- dig {domain} ANY +noall +answer", priority: 5 },
    { key: "dns.zone_xfer", title: "Zone transfer attempt", type: "mechanical", command: "pk exec -- dig @$(dig {domain} NS +short | head -1) {domain} AXFR", priority: 10 },
    { key: "dns.whois", title: "WHOIS lookup", type: "mechanical", command: "pk exec -- whois {domain}", priority: 8 },
  ],
};

export const SSL_INSPECT_BLOCK: BlockDef = {
  name: "SSL/TLS Inspection",
  description: "Certificate analysis and TLS configuration check. Used in blackbox recon.",
  inputSchema: { host: "string", port: "number" },
  outputSchema: { cert_cn: "string", alt_names: "string[]" },
  nodes: [
    { key: "ssl.cert", title: "SSL certificate details", type: "mechanical", command: "pk exec -- echo | openssl s_client -connect {host}:{port} -servername {host} 2>/dev/null | openssl x509 -noout -text | head -30", priority: 5 },
    { key: "ssl.alt_names", title: "Extract SAN / alt names", type: "mechanical", command: "pk exec -- echo | openssl s_client -connect {host}:{port} -servername {host} 2>/dev/null | openssl x509 -noout -ext subjectAltName", priority: 8, dependsOn: ["ssl.cert"] },
  ],
};

export const BUILTIN_BLOCKS: BlockDef[] = [
  WEB_RECON_BLOCK,
  HTTP_ENUM_BLOCK,
  SMB_ENUM_BLOCK,
  SSH_ATTEMPT_BLOCK,
  FTP_CHECK_BLOCK,
  LINUX_PRIVESC_BLOCK,
  DNS_RECON_BLOCK,
  SSL_INSPECT_BLOCK,
];
