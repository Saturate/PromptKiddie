export interface NmapHost {
  address: string;
  hostnames: string[];
  state: string;
  ports: NmapPort[];
}

export interface NmapPort {
  protocol: string;
  portid: number;
  state: string;
  service: string;
  product: string;
  version: string;
  cpe: string[];
}

export interface NmapResult {
  hosts: NmapHost[];
  summary: string;
}

export function parseNmapXml(xml: string): NmapResult {
  const hosts: NmapHost[] = [];
  const hostRegex = /<host[^>]*>([\s\S]*?)<\/host>/g;
  let match: RegExpExecArray | null;

  while ((match = hostRegex.exec(xml)) !== null) {
    const block = match[1];

    const addrMatch = block.match(/<address addr="([^"]+)"/);
    const address = addrMatch?.[1] ?? "unknown";

    const hostnames: string[] = [];
    const hnRegex = /<hostname name="([^"]+)"/g;
    let hnMatch: RegExpExecArray | null;
    while ((hnMatch = hnRegex.exec(block)) !== null) {
      hostnames.push(hnMatch[1]);
    }

    const stateMatch = block.match(/<status state="([^"]+)"/);
    const state = stateMatch?.[1] ?? "unknown";

    const ports: NmapPort[] = [];
    const portRegex = /<port protocol="([^"]+)" portid="(\d+)">([\s\S]*?)<\/port>/g;
    let portMatch: RegExpExecArray | null;
    while ((portMatch = portRegex.exec(block)) !== null) {
      const portBlock = portMatch[3];
      const portState = portBlock.match(/<state state="([^"]+)"/)?.[1] ?? "unknown";
      const svcName = portBlock.match(/service name="([^"]+)"/)?.[1] ?? "";
      const svcProduct = portBlock.match(/product="([^"]+)"/)?.[1] ?? "";
      const svcVersion = portBlock.match(/version="([^"]+)"/)?.[1] ?? "";

      const cpes: string[] = [];
      const cpeRegex = /<cpe>([^<]+)<\/cpe>/g;
      let cpeMatch: RegExpExecArray | null;
      while ((cpeMatch = cpeRegex.exec(portBlock)) !== null) {
        cpes.push(cpeMatch[1]);
      }

      ports.push({
        protocol: portMatch[1],
        portid: parseInt(portMatch[2], 10),
        state: portState,
        service: svcName,
        product: svcProduct,
        version: svcVersion,
        cpe: cpes,
      });
    }

    hosts.push({ address, hostnames, state, ports });
  }

  const summaryMatch = xml.match(/summary="([^"]+)"/);
  const summary = summaryMatch?.[1] ?? "";

  return { hosts, summary };
}
