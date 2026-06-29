/**
 * Repo interface + factory. Provides a uniform API for accessing engagement data
 * either directly (local DB) or via the HTTP API server.
 */
import { loadConfig } from "./config.js";

export interface Repo {
  createEngagement(input: { name: string; type: string; scope?: string; group?: string; sourceUrl?: string; brief?: string }): Promise<unknown>;
  listEngagements(): Promise<unknown[]>;
  getEngagement(id: string): Promise<unknown>;
  updateEngagement(id: string, input: Record<string, unknown>): Promise<unknown>;
  setEngagementStatus(id: string, status: string): Promise<unknown>;
  deleteEngagement(id: string): Promise<unknown>;
  advancePhase(id: string, targetPhase: string): Promise<unknown>;
  getPhase(id: string): Promise<unknown>;

  addTarget(input: { engagementId: string; kind: string; identifier: string; inScope?: boolean; notes?: string }): Promise<unknown>;
  listTargets(engagementId: string): Promise<unknown[]>;
  updateTarget(id: string, input: Record<string, unknown>): Promise<unknown>;

  addPort(input: { targetId: string; port: number; protocol?: string; state?: string; service?: string; version?: string; banner?: string; notes?: string }): Promise<unknown>;
  listPorts(targetId: string): Promise<unknown[]>;
  updatePort(id: string, input: Record<string, unknown>): Promise<unknown>;

  addFinding(input: Record<string, unknown>): Promise<unknown>;
  listFindings(engagementId: string): Promise<unknown[]>;
  updateFinding(id: string, input: Record<string, unknown>): Promise<unknown>;

  addObjective(input: { engagementId: string; taskNumber: number; title: string; description?: string; flagFormat?: string }): Promise<unknown>;
  listObjectives(engagementId: string): Promise<unknown[]>;
  updateObjective(id: string, input: Record<string, unknown>): Promise<unknown>;
  captureFlag(id: string, flag: string): Promise<unknown>;

  addArtifact(input: { engagementId: string; title: string; type: string; content?: string; path?: string; findingId?: string; meta?: Record<string, unknown> }): Promise<unknown>;
  listArtifacts(engagementId: string): Promise<unknown[]>;

  addEvidence(input: { engagementId: string; path: string; type: string; findingId?: string; sha256?: string; sizeBytes?: number; meta?: Record<string, unknown> }): Promise<unknown>;
  listEvidence(engagementId: string): Promise<unknown[]>;

  logActivity(input: { engagementId: string; phase: string; action: string; command?: string; actor?: string; resultEvidenceId?: string }): Promise<unknown>;
  listActivity(engagementId: string): Promise<unknown[]>;

  startAgentRun(input: { engagementId: string; agent: string; phase: string }): Promise<unknown>;
  listAgentRuns(engagementId: string): Promise<unknown[]>;
  finishAgentRun(input: { runId: string; status: string; summary?: string }): Promise<unknown>;

  addAgentLog(input: { engagementId: string; agent: string; phase: string; message: string; category?: string }): Promise<unknown>;
  listAgentLog(engagementId: string): Promise<unknown[]>;

  sendMessage(input: { body: string; engagementId?: string; direction?: string; author?: string }): Promise<unknown>;
  listMessages(engagementId: string): Promise<unknown[]>;
  pollInbox(engagementId?: string): Promise<unknown[]>;
}

function createLocalRepo(): Repo {
  const r = import("./repo.js");
  return {
    createEngagement: async (i) => (await r).createEngagement(i as Parameters<Awaited<typeof r>["createEngagement"]>[0]),
    listEngagements: async () => (await r).listEngagements(),
    getEngagement: async (id) => (await r).getEngagement(id),
    updateEngagement: async (id, i) => (await r).updateEngagement(id, i),
    setEngagementStatus: async (id, s) => (await r).setEngagementStatus(id, s as Parameters<Awaited<typeof r>["setEngagementStatus"]>[1]),
    deleteEngagement: async (id) => (await r).deleteEngagement(id),
    advancePhase: async (id, p) => (await r).advancePhase(id, p as Parameters<Awaited<typeof r>["advancePhase"]>[1]),
    getPhase: async (id) => (await r).getPhase(id),
    addTarget: async (i) => (await r).addTarget(i as Parameters<Awaited<typeof r>["addTarget"]>[0]),
    listTargets: async (eid) => (await r).listTargets(eid),
    updateTarget: async (id, i) => (await r).updateTarget(id, i),
    addPort: async (i) => (await r).addPort(i as Parameters<Awaited<typeof r>["addPort"]>[0]),
    listPorts: async (tid) => (await r).listPorts(tid),
    updatePort: async (id, i) => (await r).updatePort(id, i as Parameters<Awaited<typeof r>["updatePort"]>[1]),
    addFinding: async (i) => (await r).addFinding(i as Parameters<Awaited<typeof r>["addFinding"]>[0]),
    listFindings: async (eid) => (await r).listFindings(eid),
    updateFinding: async (id, i) => (await r).updateFinding(id, i as Parameters<Awaited<typeof r>["updateFinding"]>[1]),
    addObjective: async (i) => (await r).addObjective(i),
    listObjectives: async (eid) => (await r).listObjectives(eid),
    updateObjective: async (id, i) => (await r).updateObjective(id, i),
    captureFlag: async (id, flag) => (await r).captureFlag(id, flag),
    addArtifact: async (i) => (await r).addArtifact(i),
    listArtifacts: async (eid) => (await r).listArtifacts(eid),
    addEvidence: async (i) => (await r).addEvidence(i as Parameters<Awaited<typeof r>["addEvidence"]>[0]),
    listEvidence: async (eid) => (await r).listEvidence(eid),
    logActivity: async (i) => (await r).logActivity(i as Parameters<Awaited<typeof r>["logActivity"]>[0]),
    listActivity: async (eid) => (await r).listActivity(eid),
    startAgentRun: async (i) => (await r).startAgentRun(i as Parameters<Awaited<typeof r>["startAgentRun"]>[0]),
    listAgentRuns: async (eid) => (await r).listAgentRuns(eid),
    finishAgentRun: async (i) => (await r).finishAgentRun(i as Parameters<Awaited<typeof r>["finishAgentRun"]>[0]),
    addAgentLog: async (i) => (await r).addAgentLog(i as Parameters<Awaited<typeof r>["addAgentLog"]>[0]),
    listAgentLog: async (eid) => (await r).listAgentLog(eid),
    sendMessage: async (i) => (await r).sendMessage(i as Parameters<Awaited<typeof r>["sendMessage"]>[0]),
    listMessages: async (eid) => (await r).listMessages(eid),
    pollInbox: async (eid) => (await r).pollInbox(eid),
  };
}

function createHttpRepo(baseUrl: string, secret: string | null): Repo {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["Authorization"] = `Bearer ${secret}`;

  const get = async <T = unknown>(path: string): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const patch = async (path: string, body: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const put = async (path: string, body: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const del = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  };

  return {
    createEngagement: (i) => post("/engagements", i),
    listEngagements: () => get<unknown[]>("/engagements"),
    getEngagement: (id) => get(`/engagements/${id}`),
    updateEngagement: (id, i) => patch(`/engagements/${id}`, i),
    setEngagementStatus: (id, status) => put(`/engagements/${id}/status`, { status }),
    deleteEngagement: (id) => del(`/engagements/${id}`),
    advancePhase: (id, phase) => put(`/engagements/${id}/phase`, { phase }),
    getPhase: (id) => get(`/engagements/${id}/phase`),
    addTarget: (i) => post(`/engagements/${i.engagementId}/targets`, i),
    listTargets: (eid) => get<unknown[]>(`/engagements/${eid}/targets`),
    updateTarget: (id, i) => patch(`/targets/${id}`, i),
    addPort: (i) => post(`/targets/${i.targetId}/ports`, i),
    listPorts: (tid) => get<unknown[]>(`/targets/${tid}/ports`),
    updatePort: (id, i) => patch(`/ports/${id}`, i),
    addFinding: (i) => post(`/engagements/${(i as Record<string, string>).engagementId}/findings`, i),
    listFindings: (eid) => get<unknown[]>(`/engagements/${eid}/findings`),
    updateFinding: (id, i) => patch(`/findings/${id}`, i),
    addObjective: (i) => post(`/engagements/${i.engagementId}/objectives`, i),
    listObjectives: (eid) => get<unknown[]>(`/engagements/${eid}/objectives`),
    updateObjective: (id, i) => patch(`/objectives/${id}`, i),
    captureFlag: (id, flag) => put(`/objectives/${id}/capture`, { flag }),
    addArtifact: (i) => post(`/engagements/${i.engagementId}/artifacts`, i),
    listArtifacts: (eid) => get<unknown[]>(`/engagements/${eid}/artifacts`),
    addEvidence: (i) => post(`/engagements/${i.engagementId}/evidence`, i),
    listEvidence: (eid) => get<unknown[]>(`/engagements/${eid}/evidence`),
    logActivity: (i) => post(`/engagements/${i.engagementId}/activity`, i),
    listActivity: (eid) => get<unknown[]>(`/engagements/${eid}/activity`),
    startAgentRun: (i) => post(`/engagements/${i.engagementId}/agent-runs`, i),
    listAgentRuns: (eid) => get<unknown[]>(`/engagements/${eid}/agent-runs`),
    finishAgentRun: (i) => put(`/agent-runs/${i.runId}/finish`, i),
    addAgentLog: (i) => post(`/engagements/${i.engagementId}/agent-log`, i),
    listAgentLog: (eid) => get<unknown[]>(`/engagements/${eid}/agent-log`),
    sendMessage: (i) => post("/messages", i),
    listMessages: (eid) => get<unknown[]>(`/messages?engagementId=${eid}`),
    pollInbox: (eid) => get<unknown[]>(`/messages/poll${eid ? `?engagementId=${eid}` : ""}`),
  };
}

let _repo: Repo | null = null;

export function getRepo(): Repo {
  if (_repo) return _repo;
  const config = loadConfig();
  _repo = config.api.url
    ? createHttpRepo(config.api.url, config.api.secret)
    : createLocalRepo();
  return _repo;
}
