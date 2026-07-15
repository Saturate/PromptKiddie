import { describe, it, expect } from "vitest";
import { computeGraphState, type ReplayEvent } from "@/hooks/use-replay";
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
  node("port_scan", ["PortDiscovered", "VersionIdentified"]),
  node("udp_scan", ["PortDiscovered"]),
  node("web_recon", ["VersionIdentified", "HostnameFound"]),
  node("cve_search", ["ExploitAvailable"]),
  node("exploit", ["ShellObtained"]),
  node("flag_capture", ["FlagCaptured"]),
];

const EDGES: ActionEdge[] = [
  edge("__start__", "port_scan", "EngagementStarted"),
  edge("__start__", "udp_scan", "EngagementStarted"),
  edge("port_scan", "web_recon", "PortDiscovered"),
  edge("web_recon", "cve_search", "VersionIdentified"),
  edge("port_scan", "cve_search", "VersionIdentified"),
  edge("cve_search", "exploit", "ExploitAvailable"),
  edge("exploit", "flag_capture", "ShellObtained"),
];

const BASE = new Date("2026-07-12T10:00:00Z").getTime();
function ts(offsetMs: number): string {
  return new Date(BASE + offsetMs).toISOString();
}

const EVENTS: ReplayEvent[] = [
  { id: "e0", type: "EngagementStarted", payload: {}, source: "supervisor", createdAt: ts(0) },
  { id: "e1", type: "PortDiscovered", payload: { port: 80, service: "http" }, source: "port_scan", createdAt: ts(60000) },
  { id: "e2", type: "VersionIdentified", payload: { product: "nginx", version: "1.28.0" }, source: "web_recon", createdAt: ts(120000) },
  { id: "e3", type: "ShellObtained", payload: { user: "lp" }, source: "exploit", createdAt: ts(300000) },
  { id: "e4", type: "FlagCaptured", payload: { type: "user" }, source: "flag_capture", createdAt: ts(360000) },
];

describe("replay seek computation (via computeGraphState)", () => {
  it("seek to first event activates port_scan and udp_scan", () => {
    const state = computeGraphState(EVENTS, NODES, EDGES, 0);
    expect(state.activeNodes.has("port_scan")).toBe(true);
    expect(state.activeNodes.has("udp_scan")).toBe(true);
    expect(state.doneNodes.size).toBe(0);
    expect(state.activeEdges.has("__start__->port_scan")).toBe(true);
    expect(state.activeEdges.has("__start__->udp_scan")).toBe(true);
    expect(state.log).toHaveLength(1);
    expect(state.log[0].time).toBe(0);
  });

  it("seek to PortDiscovered activates web_recon, marks port_scan+udp_scan done", () => {
    const state = computeGraphState(EVENTS, NODES, EDGES, 1);
    expect(state.activeNodes.has("web_recon")).toBe(true);
    expect(state.doneNodes.has("port_scan")).toBe(true);
    expect(state.doneNodes.has("udp_scan")).toBe(true);
    expect(state.log).toHaveLength(2);
    expect(state.log[1].time).toBe(60);
  });

  it("seek to VersionIdentified activates cve_search", () => {
    const state = computeGraphState(EVENTS, NODES, EDGES, 2);
    expect(state.activeNodes.has("cve_search")).toBe(true);
    expect(state.doneNodes.has("web_recon")).toBe(true);
    expect(state.log).toHaveLength(3);
    expect(state.log[2].time).toBe(120);
  });

  it("seek to last event shows full engagement timeline", () => {
    const state = computeGraphState(EVENTS, NODES, EDGES, 4);
    expect(state.log).toHaveLength(5);
    expect(state.log[4].time).toBe(360);
    expect(state.activeNodes.size).toBe(0);
    expect(state.doneNodes.has("port_scan")).toBe(true);
    expect(state.doneNodes.has("web_recon")).toBe(true);
    expect(state.doneNodes.has("cve_search")).toBe(true);
    expect(state.doneNodes.has("flag_capture")).toBe(true);
  });

  it("active nodes are removed from done set", () => {
    const state = computeGraphState(EVENTS, NODES, EDGES, 3);
    expect(state.activeNodes.has("flag_capture")).toBe(true);
    expect(state.doneNodes.has("flag_capture")).toBe(false);
  });

  it("elapsed time is computed from real timestamps", () => {
    const state = computeGraphState(EVENTS, NODES, EDGES, 3);
    expect(state.log[3].time).toBe(300);
  });
});
