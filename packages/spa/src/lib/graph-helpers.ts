import type { ActionNode, ActionEdge } from "@promptkiddie/core";

export interface ActionNodeWithState extends ActionNode {
  running: number;
  eventCount: number;
}

export interface LiveEvent {
  time: string;
  type: string;
  payload: Record<string, unknown>;
  source: string;
}

export interface LiveOutputLine {
  action: string;
  line: string;
  time: string;
}

export function eventSummary(e: { type: string; payload: Record<string, unknown> }): string {
  const p = e.payload;
  switch (e.type) {
    case "PortDiscovered":
      return `${p.port}/${p.service}${p.version ? ` (${p.version})` : ""}`;
    case "VersionIdentified":
      return `${p.product}${p.version ? ` ${p.version}` : ""}`;
    case "HostnameFound":
      return String(p.hostname);
    case "FileDownloaded":
      return String(p.path);
    case "FindingAdded":
      return `${p.severity}: ${p.title}`;
    case "ShellObtained":
      return `${p.user} via ${p.method}`;
    case "CredentialFound":
      return `${p.username} (${p.source})`;
    case "FlagCaptured":
      return `${p.type} flag`;
    case "PathDiscovered":
      return `${p.url} [${p.status}]`;
    default:
      return "";
  }
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toFixed(0)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function buildEmitterMap(nodes: ActionNodeWithState[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of nodes) {
    for (const eventType of node.emits) {
      const list = map.get(eventType) ?? [];
      list.push(node.id);
      map.set(eventType, list);
    }
  }
  return map;
}

export function buildConsumerMap(
  nodes: ActionNodeWithState[],
  edges: ActionEdge[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.event) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    map.set(edge.event, list);
  }
  const startEdges = edges.filter((e) => e.from === "__start__");
  if (startEdges.length > 0) {
    const existing = map.get("EngagementStarted") ?? [];
    for (const se of startEdges) {
      if (!existing.includes(se.to)) existing.push(se.to);
    }
    map.set("EngagementStarted", existing);
  }
  return map;
}
