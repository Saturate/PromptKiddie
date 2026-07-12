/**
 * Build a visualization graph from a set of {@link Action} definitions.
 *
 * Static analysis: matches each action's {@link Action.emits} array against
 * other actions' {@link Action.on} triggers by testing synthetic events.
 *
 * The result is a node+edge graph suitable for react-flow rendering.
 */
import type { Action, EngagementEvent } from "./sdk.js";

export interface ActionNode {
  id: string;
  name: string;
  description?: string;
  tier?: string;
  emits: string[];
}

export interface ActionEdge {
  from: string;
  to: string;
  event: string;
}

export interface ActionGraph {
  nodes: ActionNode[];
  edges: ActionEdge[];
}

const STANDARD_EVENTS = [
  "EngagementStarted",
  "PortDiscovered",
  "VersionIdentified",
  "HostnameFound",
  "FileDownloaded",
  "FindingAdded",
  "CredentialFound",
  "ShellObtained",
  "FlagCaptured",
  "ExploitAvailable",
  "PathDiscovered",
  "StallDetected",
  "CommandFailed",
];

function syntheticEvent(type: string): EngagementEvent {
  const payloads: Record<string, Record<string, unknown>> = {
    PortDiscovered: { port: 80, proto: "tcp", service: "http", version: "test" },
    VersionIdentified: { product: "test", version: "1.0.0", source: "test" },
    HostnameFound: { hostname: "test.htb", source: "test" },
    FileDownloaded: { path: "test.py", type: "python", url: "/test" },
    FindingAdded: { severity: "critical", title: "test", description: "test" },
    CredentialFound: { username: "test", source: "test", hashFile: "/tmp/hashes" },
    ShellObtained: { user: "test", method: "test", stable: true },
    FlagCaptured: { type: "user", value: "test" },
    ExploitAvailable: { cve: "CVE-0000-0000", product: "test", cvss: 10.0 },
    PathDiscovered: { url: "http://test/path", status: 200 },
  };

  return {
    id: "synthetic",
    type,
    payload: payloads[type] ?? {},
    source: "graph-builder",
    engagementId: "synthetic",
    createdAt: new Date(),
  };
}

/**
 * Build a static action graph by testing each action's trigger against
 * synthetic events for every type in {@link Action.emits} across all actions.
 */
export function buildActionGraph(actions: Action[]): ActionGraph {
  const nodes: ActionNode[] = actions.map((a) => ({
    id: a.name,
    name: a.name,
    description: a.description,
    tier: a.tier,
    emits: a.emits ?? [],
  }));

  const edges: ActionEdge[] = [];
  const allEmittedTypes = new Set<string>();

  for (const a of actions) {
    for (const eventType of a.emits ?? []) {
      allEmittedTypes.add(eventType);
    }
  }

  for (const eventType of [...allEmittedTypes, ...STANDARD_EVENTS]) {
    const synthetic = syntheticEvent(eventType);
    const producers = actions.filter((a) => a.emits?.includes(eventType));
    const consumers = actions.filter((a) => {
      try {
        return a.on(synthetic);
      } catch {
        return false;
      }
    });

    for (const producer of producers) {
      for (const consumer of consumers) {
        if (producer.name === consumer.name) continue;
        const exists = edges.some((e) => e.from === producer.name && e.to === consumer.name && e.event === eventType);
        if (!exists) {
          edges.push({ from: producer.name, to: consumer.name, event: eventType });
        }
      }
    }

    if (producers.length === 0 && eventType === "EngagementStarted") {
      for (const consumer of consumers) {
        edges.push({ from: "__start__", to: consumer.name, event: eventType });
      }
    }
  }

  if (edges.some((e) => e.from === "__start__")) {
    nodes.unshift({ id: "__start__", name: "Start", tier: "auto", emits: ["EngagementStarted"] });
  }

  return { nodes, edges };
}
