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

export const BUILTIN_BLOCKS: BlockDef[] = [
  WEB_RECON_BLOCK,
].map(withStartEnd);
