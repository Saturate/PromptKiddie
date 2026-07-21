import { describe, it, expect, vi } from "vitest";

const ENG = { id: "aaa-bbb-ccc", name: "Test Engagement", slug: "test-engagement", type: "ctf", status: "active", phase: "recon" };
const TGT = { id: "tgt-111", engagementId: "aaa-bbb-ccc", kind: "host", identifier: "10.0.0.1", inScope: true };
const FND = { id: "fnd-222", engagementId: "aaa-bbb-ccc", title: "SQLi in login", severity: "high", status: "triage" };

vi.mock("@promptkiddie/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@promptkiddie/core")>();

  const eng = { id: "aaa-bbb-ccc", name: "Test Engagement", slug: "test-engagement", type: "ctf", status: "active", phase: "recon" };
  const tgt = { id: "tgt-111", engagementId: "aaa-bbb-ccc", kind: "host", identifier: "10.0.0.1", inScope: true };
  const fnd = { id: "fnd-222", engagementId: "aaa-bbb-ccc", title: "SQLi in login", severity: "high", status: "triage" };

  return {
    ...actual,

    createEngagement: vi.fn().mockResolvedValue(eng),
    listEngagements: vi.fn().mockResolvedValue([eng]),
    getEngagement: vi.fn().mockImplementation(async (id: string) => id === eng.id ? eng : null),
    updateEngagement: vi.fn().mockImplementation(async (id: string, input: Record<string, unknown>) => id === eng.id ? { ...eng, ...input } : null),
    deleteEngagement: vi.fn().mockImplementation(async (id: string) => id === eng.id ? eng : null),
    setEngagementStatus: vi.fn().mockImplementation(async (id: string, status: string) => id === eng.id ? { ...eng, status } : null),
    getPhase: vi.fn().mockResolvedValue({ phase: "recon" }),
    advancePhase: vi.fn().mockResolvedValue({ engagement: { ...eng, phase: "enum" } }),
    emitEvent: vi.fn().mockResolvedValue({ id: "evt-1", type: "StatusChanged" }),

    addTarget: vi.fn().mockResolvedValue(tgt),
    listTargets: vi.fn().mockResolvedValue([tgt]),
    updateTarget: vi.fn().mockImplementation(async (id: string, input: Record<string, unknown>) => id === tgt.id ? { ...tgt, ...input } : null),

    addFinding: vi.fn().mockResolvedValue(fnd),
    listFindings: vi.fn().mockResolvedValue([fnd]),
    updateFinding: vi.fn().mockImplementation(async (id: string, input: Record<string, unknown>) => id === fnd.id ? { ...fnd, ...input } : null),

    addObjective: vi.fn().mockResolvedValue({ id: "obj-1" }),
    listObjectives: vi.fn().mockResolvedValue([]),
    updateObjective: vi.fn().mockResolvedValue(null),
    captureFlag: vi.fn().mockResolvedValue({ id: "obj-1", completed: true }),

    addArtifact: vi.fn().mockResolvedValue({ id: "art-1" }),
    listArtifacts: vi.fn().mockResolvedValue([]),

    addEvidence: vi.fn().mockResolvedValue({ id: "evi-1" }),
    listEvidence: vi.fn().mockResolvedValue([]),

    logActivity: vi.fn().mockResolvedValue({ id: "act-1" }),
    listActivity: vi.fn().mockResolvedValue([]),

    startAgentRun: vi.fn().mockResolvedValue({ id: "run-1" }),
    listAgentRuns: vi.fn().mockResolvedValue([]),
    finishAgentRun: vi.fn().mockImplementation(async (input: { runId: string }) => input.runId === "run-1" ? { id: "run-1", status: "ok" } : null),
    addAgentLog: vi.fn().mockResolvedValue({ id: "log-1" }),
    listAgentLog: vi.fn().mockResolvedValue([]),
  };
});

import { createApp } from "../app.js";

function req(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, opts);
}

describe("Engagement routes", () => {
  const app = createApp();

  it("POST /engagements creates engagement", async () => {
    const res = await app.request(req("POST", "/engagements", { name: "Test", type: "ctf" }));
    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.id).toBe(ENG.id);
  });

  it("GET /engagements lists engagements", async () => {
    const res = await app.request(req("GET", "/engagements"));
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(data).toHaveLength(1);
  });

  it("GET /engagements/:id returns engagement", async () => {
    const res = await app.request(req("GET", `/engagements/${ENG.id}`));
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.name).toBe("Test Engagement");
  });

  it("GET /engagements/:id returns 404 for unknown id", async () => {
    const res = await app.request(req("GET", "/engagements/nonexistent"));
    expect(res.status).toBe(404);
  });

  it("PATCH /engagements/:id updates engagement", async () => {
    const res = await app.request(req("PATCH", `/engagements/${ENG.id}`, { name: "Updated" }));
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.name).toBe("Updated");
  });

  it("PATCH /engagements/:id returns 404 for unknown id", async () => {
    const res = await app.request(req("PATCH", "/engagements/nonexistent", { name: "X" }));
    expect(res.status).toBe(404);
  });

  it("DELETE /engagements/:id deletes engagement", async () => {
    const res = await app.request(req("DELETE", `/engagements/${ENG.id}`));
    expect(res.status).toBe(200);
  });

  it("DELETE /engagements/:id returns 404 for unknown id", async () => {
    const res = await app.request(req("DELETE", "/engagements/nonexistent"));
    expect(res.status).toBe(404);
  });

  it("PUT /engagements/:id/status changes status", async () => {
    const res = await app.request(req("PUT", `/engagements/${ENG.id}/status`, { status: "paused" }));
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("paused");
  });

  it("PUT /engagements/:id/status returns 404 for unknown id", async () => {
    const res = await app.request(req("PUT", "/engagements/nonexistent/status", { status: "paused" }));
    expect(res.status).toBe(404);
  });

  it("GET /engagements/:id/phase returns phase", async () => {
    const res = await app.request(req("GET", `/engagements/${ENG.id}/phase`));
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.phase).toBe("recon");
  });

  it("PUT /engagements/:id/phase advances phase", async () => {
    const res = await app.request(req("PUT", `/engagements/${ENG.id}/phase`, { phase: "enum" }));
    expect(res.status).toBe(200);
  });
});

describe("Target routes", () => {
  const app = createApp();

  it("POST /engagements/:id/targets creates target", async () => {
    const res = await app.request(req("POST", `/engagements/${ENG.id}/targets`, {
      kind: "host", identifier: "10.0.0.1", inScope: true,
    }));
    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.identifier).toBe("10.0.0.1");
  });

  it("GET /engagements/:id/targets lists targets", async () => {
    const res = await app.request(req("GET", `/engagements/${ENG.id}/targets`));
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  it("PATCH /targets/:id updates target", async () => {
    const res = await app.request(req("PATCH", `/targets/${TGT.id}`, { notes: "updated" }));
    expect(res.status).toBe(200);
  });

  it("PATCH /targets/:id returns 404 for unknown id", async () => {
    const res = await app.request(req("PATCH", "/targets/nonexistent", { notes: "x" }));
    expect(res.status).toBe(404);
  });
});

describe("Finding routes", () => {
  const app = createApp();

  it("POST /engagements/:id/findings creates finding", async () => {
    const res = await app.request(req("POST", `/engagements/${ENG.id}/findings`, {
      title: "SQLi", severity: "high",
    }));
    expect(res.status).toBe(201);
    const data = await res.json() as Record<string, unknown>;
    expect(data.title).toBe("SQLi in login");
  });

  it("GET /engagements/:id/findings lists findings", async () => {
    const res = await app.request(req("GET", `/engagements/${ENG.id}/findings`));
    expect(res.status).toBe(200);
  });

  it("PATCH /findings/:id updates finding", async () => {
    const res = await app.request(req("PATCH", `/findings/${FND.id}`, { status: "confirmed" }));
    expect(res.status).toBe(200);
  });

  it("PATCH /findings/:id returns 404 for unknown id", async () => {
    const res = await app.request(req("PATCH", "/findings/nonexistent", { status: "x" }));
    expect(res.status).toBe(404);
  });
});

describe("Agent run routes", () => {
  const app = createApp();

  it("POST /engagements/:id/agent-runs starts a run", async () => {
    const res = await app.request(req("POST", `/engagements/${ENG.id}/agent-runs`, {
      agent: "recon-agent", phase: "recon",
    }));
    expect(res.status).toBe(201);
  });

  it("GET /engagements/:id/agent-runs lists runs", async () => {
    const res = await app.request(req("GET", `/engagements/${ENG.id}/agent-runs`));
    expect(res.status).toBe(200);
  });

  it("PUT /agent-runs/:id/finish marks run complete", async () => {
    const res = await app.request(req("PUT", "/agent-runs/run-1/finish", { status: "ok", summary: "done" }));
    expect(res.status).toBe(200);
  });

  it("PUT /agent-runs/:id/finish returns 404 for unknown id", async () => {
    const res = await app.request(req("PUT", "/agent-runs/nonexistent/finish", { status: "ok" }));
    expect(res.status).toBe(404);
  });
});
