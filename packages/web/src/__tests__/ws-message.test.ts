import { describe, it, expect } from "vitest";
import { processWsMessage, type ReplayState, type WsMessage } from "@/hooks/use-replay";
import type { ActionNodeWithState } from "@/hooks/graph-helpers";
import type { ActionEdge } from "@promptkiddie/core";

function node(id: string, emits: string[] = []): ActionNodeWithState {
  return { id, name: id, kind: "script", emits, running: 0, eventCount: 0 };
}

function edge(from: string, to: string, event: string): ActionEdge {
  return { from, to, event };
}

const NODES: ActionNodeWithState[] = [
  node("__start__", ["EngagementStarted"]),
  node("port_scan", ["PortDiscovered"]),
  node("udp_scan", ["PortDiscovered"]),
  node("web_recon", ["VersionIdentified", "HostnameFound"]),
  node("exploit", ["ShellObtained"]),
  node("flag_capture", ["FlagCaptured"]),
];

const EDGES: ActionEdge[] = [
  edge("__start__", "port_scan", "EngagementStarted"),
  edge("__start__", "udp_scan", "EngagementStarted"),
  edge("port_scan", "web_recon", "PortDiscovered"),
  edge("udp_scan", "web_recon", "PortDiscovered"),
  edge("web_recon", "exploit", "VersionIdentified"),
  edge("exploit", "flag_capture", "ShellObtained"),
];

function emptyState(): ReplayState {
  return {
    loading: false,
    playing: true,
    autoPlay: false,
    currentIndex: -1,
    activeNodes: new Set(),
    doneNodes: new Set(),
    activeEdges: new Set(),
    log: [],
    speed: 1,
    events: [],
    totalDuration: 0,
    live: true,
    liveConnected: true,
    outputLines: [],
  };
}

describe("processWsMessage - event messages", () => {
  it("appends event to events array and log", () => {
    const msg: WsMessage = {
      type: "event",
      data: { id: "e1", type: "EngagementStarted", payload: {}, source: "supervisor", createdAt: "2026-07-12T10:00:00Z" },
    };

    const next = processWsMessage(msg, emptyState(), NODES, EDGES);

    expect(next.events).toHaveLength(1);
    expect(next.events[0].type).toBe("EngagementStarted");
    expect(next.log).toHaveLength(1);
    expect(next.log[0].time).toBe(0);
    expect(next.currentIndex).toBe(0);
  });

  it("activates consumer nodes on event", () => {
    const msg: WsMessage = {
      type: "event",
      data: { id: "e1", type: "EngagementStarted", payload: {}, source: "supervisor", createdAt: "2026-07-12T10:00:00Z" },
    };

    const next = processWsMessage(msg, emptyState(), NODES, EDGES);

    expect(next.activeNodes.has("port_scan")).toBe(true);
    expect(next.activeNodes.has("udp_scan")).toBe(true);
    expect(next.activeEdges.has("__start__->port_scan")).toBe(true);
    expect(next.activeEdges.has("__start__->udp_scan")).toBe(true);
  });

  it("moves previously active nodes to done when new event triggers different nodes", () => {
    const state = emptyState();
    state.activeNodes = new Set(["port_scan", "udp_scan"]);
    state.events = [
      { id: "e0", type: "EngagementStarted", payload: {}, source: "supervisor", createdAt: "2026-07-12T10:00:00Z" },
    ];

    const msg: WsMessage = {
      type: "event",
      data: { id: "e2", type: "PortDiscovered", payload: { port: 80, service: "http" }, source: "port_scan", createdAt: "2026-07-12T10:01:00Z" },
    };

    const next = processWsMessage(msg, state, NODES, EDGES);

    expect(next.activeNodes.has("web_recon")).toBe(true);
    expect(next.doneNodes.has("port_scan")).toBe(true);
    expect(next.doneNodes.has("udp_scan")).toBe(true);
    expect(next.activeNodes.has("port_scan")).toBe(false);
  });

  it("computes elapsed time from first event", () => {
    const state = emptyState();
    state.events = [
      { id: "e0", type: "EngagementStarted", payload: {}, source: "supervisor", createdAt: "2026-07-12T10:00:00Z" },
    ];

    const msg: WsMessage = {
      type: "event",
      data: { id: "e1", type: "PortDiscovered", payload: { port: 80 }, source: "port_scan", createdAt: "2026-07-12T10:05:00Z" },
    };

    const next = processWsMessage(msg, state, NODES, EDGES);

    expect(next.log[next.log.length - 1].time).toBe(300);
    expect(next.totalDuration).toBe(300);
  });

  it("handles unknown event type gracefully (no consumers)", () => {
    const msg: WsMessage = {
      type: "event",
      data: { id: "e1", type: "UnknownEvent", payload: {}, source: "test", createdAt: "2026-07-12T10:00:00Z" },
    };

    const next = processWsMessage(msg, emptyState(), NODES, EDGES);

    expect(next.events).toHaveLength(1);
    expect(next.activeNodes.size).toBe(0);
  });
});

describe("processWsMessage - action_start/end messages", () => {
  it("action_start adds node to active set", () => {
    const msg: WsMessage = { type: "action_start", data: { name: "port_scan" } };

    const next = processWsMessage(msg, emptyState(), NODES, EDGES);

    expect(next.activeNodes.has("port_scan")).toBe(true);
  });

  it("action_end moves node from active to done", () => {
    const state = emptyState();
    state.activeNodes = new Set(["port_scan"]);

    const msg: WsMessage = { type: "action_end", data: { name: "port_scan" } };
    const next = processWsMessage(msg, state, NODES, EDGES);

    expect(next.activeNodes.has("port_scan")).toBe(false);
    expect(next.doneNodes.has("port_scan")).toBe(true);
  });

  it("action_start/end matches case-insensitively", () => {
    const msg: WsMessage = { type: "action_start", data: { name: "Port_Scan" } };
    const next = processWsMessage(msg, emptyState(), NODES, EDGES);
    expect(next.activeNodes.has("port_scan")).toBe(true);
  });

  it("ignores unknown action names", () => {
    const state = emptyState();
    const msg: WsMessage = { type: "action_start", data: { name: "nonexistent_action" } };
    const next = processWsMessage(msg, state, NODES, EDGES);
    expect(next).toBe(state);
  });
});

describe("processWsMessage - output messages", () => {
  it("appends output line", () => {
    const msg: WsMessage = { type: "output", data: { action: "port_scan", line: "Open 10.0.0.1:80" } };

    const next = processWsMessage(msg, emptyState(), NODES, EDGES);

    expect(next.outputLines).toHaveLength(1);
    expect(next.outputLines[0].action).toBe("port_scan");
    expect(next.outputLines[0].line).toBe("Open 10.0.0.1:80");
  });

  it("accumulates multiple output lines", () => {
    let state = emptyState();
    state = processWsMessage({ type: "output", data: { action: "nmap", line: "line1" } }, state, NODES, EDGES);
    state = processWsMessage({ type: "output", data: { action: "nmap", line: "line2" } }, state, NODES, EDGES);
    state = processWsMessage({ type: "output", data: { action: "nmap", line: "line3" } }, state, NODES, EDGES);

    expect(state.outputLines).toHaveLength(3);
  });
});

describe("processWsMessage - sequential event flow", () => {
  it("processes a full engagement sequence", () => {
    let state = emptyState();

    state = processWsMessage({
      type: "event",
      data: { id: "e1", type: "EngagementStarted", payload: {}, source: "supervisor", createdAt: "2026-07-12T10:00:00Z" },
    }, state, NODES, EDGES);

    expect(state.activeNodes.has("port_scan")).toBe(true);
    expect(state.activeNodes.has("udp_scan")).toBe(true);

    state = processWsMessage({
      type: "event",
      data: { id: "e2", type: "PortDiscovered", payload: { port: 80, service: "http" }, source: "port_scan", createdAt: "2026-07-12T10:01:00Z" },
    }, state, NODES, EDGES);

    expect(state.activeNodes.has("web_recon")).toBe(true);
    expect(state.doneNodes.has("port_scan")).toBe(true);

    state = processWsMessage({
      type: "event",
      data: { id: "e3", type: "VersionIdentified", payload: { product: "nginx" }, source: "web_recon", createdAt: "2026-07-12T10:02:00Z" },
    }, state, NODES, EDGES);

    expect(state.activeNodes.has("exploit")).toBe(true);
    expect(state.doneNodes.has("web_recon")).toBe(true);

    state = processWsMessage({
      type: "event",
      data: { id: "e4", type: "ShellObtained", payload: { user: "www-data" }, source: "exploit", createdAt: "2026-07-12T10:05:00Z" },
    }, state, NODES, EDGES);

    expect(state.activeNodes.has("flag_capture")).toBe(true);
    expect(state.doneNodes.has("exploit")).toBe(true);

    expect(state.events).toHaveLength(4);
    expect(state.log).toHaveLength(4);
    expect(state.totalDuration).toBe(300);
    expect(state.currentIndex).toBe(3);
  });
});
