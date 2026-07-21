/**
 * Repo interface + factory. Provides a uniform API for accessing engagement data
 * either directly (local DB) or via the HTTP API server.
 */
import { loadConfig } from "./config.js";
import type { ServiceApp, ServiceCred, ServiceCve } from "./schema.js";

export interface Repo {
  createEngagement(input: { name: string; type: string; scope?: string; group?: string; sourceUrl?: string; brief?: string }): Promise<unknown>;
  listEngagements(): Promise<unknown[]>;
  getEngagement(id: string): Promise<unknown>;
  updateEngagement(id: string, input: Record<string, unknown>): Promise<unknown>;
  setEngagementStatus(id: string, status: string): Promise<unknown>;
  deleteEngagement(id: string): Promise<unknown>;
  advancePhase(id: string, targetPhase: string): Promise<unknown>;
  getPhase(id: string): Promise<unknown>;

  registerWebshell(engagementId: string, entry: { name: string; url: string; param?: string }): Promise<unknown>;
  listWebshells(engagementId: string): Promise<unknown[]>;
  getWebshell(engagementId: string, nameOrUrl: string): Promise<unknown>;

  addTarget(input: { engagementId: string; kind: string; identifier: string; inScope?: boolean; notes?: string }): Promise<unknown>;
  listTargets(engagementId: string): Promise<unknown[]>;
  updateTarget(id: string, input: Record<string, unknown>): Promise<unknown>;

  addPort(input: { targetId: string; port: number; protocol?: string; state?: string; service?: string; version?: string; banner?: string; notes?: string }): Promise<unknown>;
  listPorts(targetId: string): Promise<unknown[]>;
  updatePort(id: string, input: Record<string, unknown>): Promise<unknown>;

  addService(input: Record<string, unknown>): Promise<unknown>;
  updateService(id: string, input: Record<string, unknown>): Promise<unknown>;
  addServiceApp(serviceId: string, app: ServiceApp): Promise<unknown>;
  addServiceCred(serviceId: string, cred: ServiceCred): Promise<unknown>;
  addServiceCve(serviceId: string, cve: ServiceCve): Promise<unknown>;
  listServices(engagementId: string, opts?: { targetId?: string }): Promise<unknown[]>;
  getService(id: string): Promise<unknown>;
  listAllCreds(engagementId: string): Promise<unknown[]>;

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

  emitEvent(engagementId: string, type: string, payload: Record<string, unknown>, source: string): Promise<unknown>;
  listEvents(engagementId: string, opts?: { type?: string }): Promise<unknown[]>;
  addDiscovery(input: { engagementId: string; type: string; category: string; summary: string; detail?: Record<string, unknown>; sourceEventId?: string; parentId?: string }): Promise<unknown>;
  listDiscoveries(engagementId: string, opts?: { category?: string; type?: string }): Promise<unknown[]>;
  getDiscoverySummary(engagementId: string): Promise<unknown>;
  recordExecOutcome(engagementId: string, command: string, target: string, exitCode: number, outcomeSummary?: string): Promise<unknown>;
  getExecDedup(engagementId: string): Promise<unknown[]>;
  isExecBlocked(engagementId: string, command: string, target: string): Promise<boolean>;
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
    registerWebshell: async (eid, entry) => (await r).registerWebshell(eid, entry),
    listWebshells: async (eid) => (await r).listWebshells(eid),
    getWebshell: async (eid, nameOrUrl) => (await r).getWebshell(eid, nameOrUrl),
    addTarget: async (i) => (await r).addTarget(i as Parameters<Awaited<typeof r>["addTarget"]>[0]),
    listTargets: async (eid) => (await r).listTargets(eid),
    updateTarget: async (id, i) => (await r).updateTarget(id, i),
    addPort: async (i) => (await r).addPort(i as Parameters<Awaited<typeof r>["addPort"]>[0]),
    listPorts: async (tid) => (await r).listPorts(tid),
    updatePort: async (id, i) => (await r).updatePort(id, i as Parameters<Awaited<typeof r>["updatePort"]>[1]),
    addService: async (i) => (await r).addService(i as Parameters<Awaited<typeof r>["addService"]>[0]),
    updateService: async (id, i) => (await r).updateService(id, i as Parameters<Awaited<typeof r>["updateService"]>[1]),
    addServiceApp: async (id, app) => (await r).addServiceApp(id, app),
    addServiceCred: async (id, cred) => (await r).addServiceCred(id, cred),
    addServiceCve: async (id, cve) => (await r).addServiceCve(id, cve),
    listServices: async (eid, opts) => (await r).listServices(eid, opts),
    getService: async (id) => (await r).getService(id),
    listAllCreds: async (eid) => (await r).listAllCreds(eid),
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
    emitEvent: async (eid, type, payload, source) => (await r).emitEvent(eid, type, payload, source),
    listEvents: async (eid, opts) => (await r).listEvents(eid, opts),
    addDiscovery: async (i) => (await r).addDiscovery(i as Parameters<Awaited<typeof r>["addDiscovery"]>[0]),
    listDiscoveries: async (eid, opts) => (await r).listDiscoveries(eid, opts as Parameters<Awaited<typeof r>["listDiscoveries"]>[1]),
    getDiscoverySummary: async (eid) => (await r).getDiscoverySummary(eid),
    recordExecOutcome: async (eid, cmd, tgt, exit, summary) => (await r).recordExecOutcome(eid, cmd, tgt, exit, summary),
    getExecDedup: async (eid) => (await r).getExecDedup(eid),
    isExecBlocked: async (eid, cmd, tgt) => (await r).isExecBlocked(eid, cmd, tgt),
  };
}

function createHttpRepo(baseUrl: string, secret: string | null): Repo {
  const base = baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["Authorization"] = `Bearer ${secret}`;

  const get = async <T = unknown>(path: string): Promise<T> => {
    const res = await fetch(`${base}${path}`, { headers });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const patch = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const put = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const del = async (path: string) => {
    const res = await fetch(`${base}${path}`, { method: "DELETE", headers });
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
    registerWebshell: (eid, entry) => post(`/engagements/${eid}/webshells`, entry),
    listWebshells: (eid) => get<unknown[]>(`/engagements/${eid}/webshells`),
    getWebshell: (eid, nameOrUrl) => get(`/engagements/${eid}/webshells/${encodeURIComponent(nameOrUrl)}`),
    addTarget: (i) => post(`/engagements/${i.engagementId}/targets`, i),
    listTargets: (eid) => get<unknown[]>(`/engagements/${eid}/targets`),
    updateTarget: (id, i) => patch(`/targets/${id}`, i),
    addPort: (i) => post(`/targets/${i.targetId}/ports`, i),
    listPorts: (tid) => get<unknown[]>(`/targets/${tid}/ports`),
    updatePort: (id, i) => patch(`/ports/${id}`, i),
    addService: (i) => post(`/engagements/${(i as Record<string, string>).engagementId}/services`, i),
    updateService: (id, i) => patch(`/services/${id}`, i),
    addServiceApp: (id, app) => post(`/services/${id}/apps`, app),
    addServiceCred: (id, cred) => post(`/services/${id}/creds`, cred),
    addServiceCve: (id, cve) => post(`/services/${id}/cves`, cve),
    listServices: (eid, opts) => get<unknown[]>(`/engagements/${eid}/services${opts?.targetId ? `?targetId=${opts.targetId}` : ""}`),
    getService: (id) => get(`/services/${id}`),
    listAllCreds: (eid) => get<unknown[]>(`/engagements/${eid}/creds`),
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
    emitEvent: (eid, type, payload, source) => post(`/engagements/${eid}/events`, { type, payload, source }),
    listEvents: (eid, opts) => get<unknown[]>(`/engagements/${eid}/events${opts?.type ? `?type=${opts.type}` : ""}`),
    addDiscovery: (i) => post(`/engagements/${i.engagementId}/discoveries`, i),
    listDiscoveries: (eid, opts) => {
      const params = new URLSearchParams();
      if (opts?.category) params.set("category", opts.category);
      if (opts?.type) params.set("type", opts.type);
      const qs = params.toString();
      return get<unknown[]>(`/engagements/${eid}/discoveries${qs ? `?${qs}` : ""}`);
    },
    getDiscoverySummary: (eid) => get(`/engagements/${eid}/discoveries/summary`),
    recordExecOutcome: (eid, cmd, tgt, exit, summary) => post(`/engagements/${eid}/exec-dedup`, { command: cmd, target: tgt, exitCode: exit, outcomeSummary: summary }),
    getExecDedup: (eid) => get<unknown[]>(`/engagements/${eid}/exec-dedup`),
    isExecBlocked: (eid, cmd, tgt) => get(`/engagements/${eid}/exec-dedup/blocked?command=${encodeURIComponent(cmd)}&target=${encodeURIComponent(tgt)}`),
  };
}

let _repo: Repo | null = null;

export function getRepo(): Repo {
  if (_repo) return _repo;
  const config = loadConfig();
  if (!config.api.url) {
    throw new Error("api.url is required. Set it in .pk/config.toml or run: pk init");
  }
  _repo = createHttpRepo(config.api.url, config.api.secret);
  return _repo;
}
