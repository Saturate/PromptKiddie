export interface NucleiFinding {
  templateId: string;
  name: string;
  severity: string;
  host: string;
  port: string;
  matchedAt: string;
  description: string;
  tags: string[];
  reference: string[];
  cveId: string[];
  cweId: string[];
  cvssMetrics: string;
  timestamp: string;
}

export function parseNucleiJsonl(output: string): NucleiFinding[] {
  const findings: NucleiFinding[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;

    try {
      const obj = JSON.parse(trimmed);
      const info = obj.info ?? {};
      const classification = info.classification ?? {};

      findings.push({
        templateId: obj["template-id"] ?? "",
        name: info.name ?? "",
        severity: info.severity ?? "info",
        host: obj.host ?? "",
        port: obj.port ?? "",
        matchedAt: obj["matched-at"] ?? "",
        description: (info.description ?? "").trim(),
        tags: info.tags ?? [],
        reference: info.reference ?? [],
        cveId: classification["cve-id"]?.filter(Boolean) ?? [],
        cweId: classification["cwe-id"]?.filter(Boolean) ?? [],
        cvssMetrics: classification["cvss-metrics"] ?? "",
        timestamp: obj.timestamp ?? "",
      });
    } catch {
      // skip unparseable lines
    }
  }

  return findings;
}
