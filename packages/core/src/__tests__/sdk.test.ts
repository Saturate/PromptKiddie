import { describe, it, expect } from "vitest";
import { createMockContext, simulateGraph, buildActionGraph } from "../index.js";
import { CTF_PLAYBOOK } from "../actions/ctf.js";
import { DEMO_EVENTS } from "../demo-events.js";

describe("Action triggers", () => {
  it("port_scan triggers on EngagementStarted", () => {
    const action = CTF_PLAYBOOK.actions.find(a => a.name === "port_scan");
    expect(action?.on({ id: "t", type: "EngagementStarted", payload: {}, source: "test", engagementId: "t", createdAt: new Date() })).toBe(true);
  });

  it("web_recon triggers on http PortDiscovered", () => {
    const action = CTF_PLAYBOOK.actions.find(a => a.name === "web_recon");
    expect(action?.on({ id: "t", type: "PortDiscovered", payload: { service: "http", port: 80 }, source: "test", engagementId: "t", createdAt: new Date() })).toBe(true);
  });

  it("web_recon does not trigger on ssh PortDiscovered", () => {
    const action = CTF_PLAYBOOK.actions.find(a => a.name === "web_recon");
    expect(action?.on({ id: "t", type: "PortDiscovered", payload: { service: "ssh", port: 22 }, source: "test", engagementId: "t", createdAt: new Date() })).toBe(false);
  });

  it("cve_search does not trigger when version is null", () => {
    const action = CTF_PLAYBOOK.actions.find(a => a.name === "cve_search");
    expect(action?.on({ id: "t", type: "VersionIdentified", payload: { product: "Flask", version: null }, source: "test", engagementId: "t", createdAt: new Date() })).toBe(false);
  });

  it("exploit triggers on critical FindingAdded", () => {
    const action = CTF_PLAYBOOK.actions.find(a => a.name === "exploit");
    expect(action?.on({ id: "t", type: "FindingAdded", payload: { severity: "critical" }, source: "test", engagementId: "t", createdAt: new Date() })).toBe(true);
  });
});

describe("simulateGraph", () => {
  it("traces the full Paperwork engagement", () => {
    const steps = simulateGraph(CTF_PLAYBOOK.actions, DEMO_EVENTS);
    const allTriggered = steps.flatMap(s => s.triggered);
    expect(allTriggered).toContain("port_scan");
    expect(allTriggered).toContain("web_recon");
    expect(allTriggered).toContain("cve_search");
    expect(allTriggered).toContain("source_code_analysis");
    expect(allTriggered).toContain("exploit");
    expect(allTriggered).toContain("flag_capture");
  });

  it("EngagementStarted triggers port_scan and udp_scan", () => {
    const steps = simulateGraph(CTF_PLAYBOOK.actions, [{ type: "EngagementStarted", payload: {} }]);
    expect(steps[0].triggered).toContain("port_scan");
    expect(steps[0].triggered).toContain("udp_scan");
  });
});

describe("buildActionGraph", () => {
  it("produces nodes and edges", () => {
    const graph = buildActionGraph(CTF_PLAYBOOK.actions);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("has port_scan -> web_recon edge via PortDiscovered", () => {
    const graph = buildActionGraph(CTF_PLAYBOOK.actions);
    const edge = graph.edges.find(e => e.from === "port_scan" && e.to === "web_recon");
    expect(edge).toBeDefined();
    expect(edge?.event).toBe("PortDiscovered");
  });
});

describe("createMockContext", () => {
  it("records emitted events", async () => {
    const ctx = createMockContext({ target: "10.0.0.1" });
    await ctx.emit("PortDiscovered", { port: 80 });
    expect(ctx.emitted).toHaveLength(1);
    expect(ctx.emitted[0].type).toBe("PortDiscovered");
  });

  it("returns configured exec results", async () => {
    const ctx = createMockContext({
      execResults: { rustscan: { stdout: "80/tcp open http", stderr: "", code: 0, durationMs: 100 } },
    });
    const result = await ctx.exec("rustscan", ["-a", "10.0.0.1"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("80/tcp");
  });
});
