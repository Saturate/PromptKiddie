import { describe, it, expect } from "vitest";
import { buildEmitterMap, buildConsumerMap, eventSummary, formatDuration, type ActionNodeWithState } from "@/hooks/graph-helpers";
import type { ActionEdge } from "@promptkiddie/core";

function node(id: string, emits: string[] = []): ActionNodeWithState {
  return { id, name: id, kind: "script", emits, running: 0, eventCount: 0 };
}

function edge(from: string, to: string, event: string): ActionEdge {
  return { from, to, event };
}

describe("buildEmitterMap", () => {
  it("maps event types to nodes that emit them", () => {
    const nodes = [
      node("port_scan", ["PortDiscovered", "VersionIdentified"]),
      node("web_recon", ["VersionIdentified", "HostnameFound"]),
      node("exploit", ["ShellObtained"]),
    ];
    const map = buildEmitterMap(nodes);

    expect(map.get("PortDiscovered")).toEqual(["port_scan"]);
    expect(map.get("VersionIdentified")).toEqual(["port_scan", "web_recon"]);
    expect(map.get("HostnameFound")).toEqual(["web_recon"]);
    expect(map.get("ShellObtained")).toEqual(["exploit"]);
    expect(map.get("Unknown")).toBeUndefined();
  });

  it("returns empty map for nodes with no emits", () => {
    const nodes = [node("snmp_enum")];
    const map = buildEmitterMap(nodes);
    expect(map.size).toBe(0);
  });
});

describe("buildConsumerMap", () => {
  it("maps event types to consumer nodes from edges", () => {
    const nodes = [
      node("port_scan", ["PortDiscovered"]),
      node("web_recon"),
      node("dir_brute"),
    ];
    const edges = [
      edge("port_scan", "web_recon", "PortDiscovered"),
      edge("port_scan", "dir_brute", "PortDiscovered"),
    ];
    const map = buildConsumerMap(nodes, edges);

    expect(map.get("PortDiscovered")).toEqual(["web_recon", "dir_brute"]);
  });

  it("deduplicates consumer entries", () => {
    const nodes = [node("a"), node("b")];
    const edges = [
      edge("a", "b", "Evt"),
      edge("a", "b", "Evt"),
    ];
    const map = buildConsumerMap(nodes, edges);
    expect(map.get("Evt")).toEqual(["b"]);
  });

  it("adds __start__ consumers for EngagementStarted", () => {
    const nodes = [node("__start__"), node("port_scan"), node("udp_scan")];
    const edges = [
      edge("__start__", "port_scan", "EngagementStarted"),
      edge("__start__", "udp_scan", "EngagementStarted"),
    ];
    const map = buildConsumerMap(nodes, edges);

    expect(map.get("EngagementStarted")).toContain("port_scan");
    expect(map.get("EngagementStarted")).toContain("udp_scan");
  });

  it("returns empty map with no edges", () => {
    const map = buildConsumerMap([], []);
    expect(map.size).toBe(0);
  });
});

describe("eventSummary", () => {
  it("formats PortDiscovered", () => {
    expect(eventSummary({ type: "PortDiscovered", payload: { port: 80, service: "http", version: "nginx 1.28" } }))
      .toBe("80/http (nginx 1.28)");
  });

  it("formats PortDiscovered without version", () => {
    expect(eventSummary({ type: "PortDiscovered", payload: { port: 22, service: "ssh" } }))
      .toBe("22/ssh");
  });

  it("formats VersionIdentified", () => {
    expect(eventSummary({ type: "VersionIdentified", payload: { product: "nginx", version: "1.28.0" } }))
      .toBe("nginx 1.28.0");
  });

  it("formats VersionIdentified without version", () => {
    expect(eventSummary({ type: "VersionIdentified", payload: { product: "Flask" } }))
      .toBe("Flask");
  });

  it("formats HostnameFound", () => {
    expect(eventSummary({ type: "HostnameFound", payload: { hostname: "target.htb" } }))
      .toBe("target.htb");
  });

  it("formats FindingAdded", () => {
    expect(eventSummary({ type: "FindingAdded", payload: { severity: "critical", title: "SQLi" } }))
      .toBe("critical: SQLi");
  });

  it("formats ShellObtained", () => {
    expect(eventSummary({ type: "ShellObtained", payload: { user: "www-data", method: "rce" } }))
      .toBe("www-data via rce");
  });

  it("formats FlagCaptured", () => {
    expect(eventSummary({ type: "FlagCaptured", payload: { type: "root" } }))
      .toBe("root flag");
  });

  it("formats PathDiscovered", () => {
    expect(eventSummary({ type: "PathDiscovered", payload: { url: "/admin", status: 200 } }))
      .toBe("/admin [200]");
  });

  it("returns empty string for unknown event types", () => {
    expect(eventSummary({ type: "UnknownEvent", payload: {} })).toBe("");
  });
});

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0.0s");
    expect(formatDuration(5.5)).toBe("5.5s");
    expect(formatDuration(59.9)).toBe("59.9s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3599)).toBe("59m 59s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(7260)).toBe("2h 1m");
  });
});
