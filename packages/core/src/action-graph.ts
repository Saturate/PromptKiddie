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
  kind: "script" | "agent" | "both";
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
    kind: a.run && a.prompt ? "both" : a.prompt ? "agent" : "script",
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
    nodes.unshift({ id: "__start__", name: "Start", kind: "script", emits: ["EngagementStarted"] });
  }

  return { nodes, edges };
}

/**
 * Export an {@link ActionGraph} as a Mermaid flowchart string.
 *
 * @example
 * ```ts
 * const graph = buildActionGraph(CTF_PLAYBOOK.actions);
 * console.log(actionGraphToMermaid(graph));
 * ```
 */
/** Result of simulating an event through the action graph. */
export interface SimulationStep {
  event: { type: string; payload: Record<string, unknown> };
  triggered: string[];
  timestamp: number;
}

/**
 * Simulate a sequence of events through a set of actions. Returns which
 * actions triggered on each event. Pure function; no side effects.
 *
 * Used by both the test suite and the frontend demo.
 *
 * @example
 * ```ts
 * const steps = simulateGraph(CTF_PLAYBOOK.actions, [
 *   { type: "EngagementStarted", payload: {} },
 *   { type: "PortDiscovered", payload: { port: 80, service: "http" } },
 * ]);
 * expect(steps[0].triggered).toContain("port_scan");
 * expect(steps[1].triggered).toContain("web_recon");
 * ```
 */
export function simulateGraph(
  actions: Action[],
  events: Array<{ type: string; payload: Record<string, unknown> }>,
): SimulationStep[] {
  const steps: SimulationStep[] = [];
  let time = 0;

  for (const event of events) {
    const synthetic: EngagementEvent = {
      id: `sim-${time}`,
      type: event.type,
      payload: event.payload,
      source: "simulation",
      engagementId: "simulation",
      createdAt: new Date(),
    };

    const triggered: string[] = [];
    for (const action of actions) {
      try {
        if (action.on(synthetic)) {
          triggered.push(action.name);
        }
      } catch {
        // trigger threw; skip
      }
    }

    steps.push({ event, triggered, timestamp: time });
    time++;
  }

  return steps;
}

export function actionGraphToMermaid(graph: ActionGraph): string {
  const lines = ["graph TD"];

  const kindShape: Record<string, [string, string]> = {
    script: ["[", "]"],
    agent: ["{{", "}}"],
    both: ["([", "])"],
  };

  for (const node of graph.nodes) {
    const [open, close] = kindShape[node.kind] ?? ["[", "]"];
    const label = node.description ? `${node.name}\\n${node.description}` : node.name;
    lines.push(`  ${node.id}${open}"${label}"${close}`);
  }

  for (const edge of graph.edges) {
    lines.push(`  ${edge.from} -->|${edge.event}| ${edge.to}`);
  }

  return lines.join("\n");
}
