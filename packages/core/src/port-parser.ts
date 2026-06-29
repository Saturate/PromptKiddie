/**
 * Parse nmap/rustscan output and auto-insert ports into the database.
 * Called after tool execution to populate ports without relying on the agent.
 */
import { addPort } from "./repo.js";

interface ParsedPort {
  port: number;
  protocol: "tcp" | "udp";
  state: "open" | "closed" | "filtered";
  service?: string;
  version?: string;
}

const NMAP_GREPABLE_RE = /^Host:\s+\S+.*Ports:\s+(.+)/gm;
const NMAP_PORT_RE = /(\d+)\/(open|closed|filtered)\/(tcp|udp)\/\/([^/]*)\/?\/([^/]*)\/?/g;
const NMAP_NORMAL_RE = /^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)(?:\s+(.*))?$/gm;

export function parseNmapOutput(output: string): ParsedPort[] {
  const ports: ParsedPort[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = NMAP_GREPABLE_RE.exec(output)) !== null) {
    const portSection = m[1];
    let pm: RegExpExecArray | null;
    const portRe = new RegExp(NMAP_PORT_RE.source, "g");
    while ((pm = portRe.exec(portSection)) !== null) {
      const key = `${pm[1]}/${pm[3]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ports.push({
        port: parseInt(pm[1], 10),
        state: pm[2] as ParsedPort["state"],
        protocol: pm[3] as ParsedPort["protocol"],
        service: pm[4] || undefined,
        version: pm[5] || undefined,
      });
    }
  }

  if (ports.length === 0) {
    const normalRe = new RegExp(NMAP_NORMAL_RE.source, "gm");
    while ((m = normalRe.exec(output)) !== null) {
      const key = `${m[1]}/${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ports.push({
        port: parseInt(m[1], 10),
        protocol: m[2] as ParsedPort["protocol"],
        state: m[3] as ParsedPort["state"],
        service: m[4] || undefined,
        version: m[5]?.trim() || undefined,
      });
    }
  }

  return ports;
}

export async function ingestPorts(targetId: string, output: string): Promise<number> {
  const parsed = parseNmapOutput(output);
  let count = 0;
  for (const p of parsed) {
    if (p.state !== "open") continue;
    await addPort({
      targetId,
      port: p.port,
      protocol: p.protocol,
      state: p.state,
      service: p.service,
      version: p.version,
    });
    count++;
  }
  return count;
}

export function looksLikeNmapOutput(output: string): boolean {
  return (
    output.includes("Nmap scan report") ||
    output.includes("PORT") && output.includes("/tcp") ||
    output.includes("Host:") && output.includes("Ports:")
  );
}
