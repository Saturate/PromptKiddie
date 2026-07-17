const BASE = (import.meta.env.VITE_API_URL ?? "") + "/api";
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function patch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function put<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function del<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Engagements
export const fetchEngagements = () => get<unknown[]>("/engagements");
export const fetchEngagement = (id: string) => get(`/engagements/${id}`);
export const createEngagement = (input: Record<string, unknown>) => post("/engagements", input);
export const updateEngagement = (id: string, input: Record<string, unknown>) => patch(`/engagements/${id}`, input);
export const deleteEngagement = (id: string) => del(`/engagements/${id}`);
export const setEngagementStatus = (id: string, status: string) => put(`/engagements/${id}/status`, { status });
export const advancePhase = (id: string, phase: string) => put(`/engagements/${id}/phase`, { phase });
export const fetchPhase = (id: string) => get(`/engagements/${id}/phase`);

// Targets
export const fetchTargets = (eid: string) => get<unknown[]>(`/engagements/${eid}/targets`);
export const addTarget = (input: Record<string, unknown>) => post(`/engagements/${(input as { engagementId: string }).engagementId}/targets`, input);
export const updateTarget = (id: string, input: Record<string, unknown>) => patch(`/targets/${id}`, input);

// Services
export const fetchServices = (eid: string, targetId?: string) => get<unknown[]>(`/engagements/${eid}/services${targetId ? `?targetId=${targetId}` : ""}`);
export const fetchService = (id: string) => get(`/services/${id}`);
export const addService = (input: Record<string, unknown>) => post(`/engagements/${(input as { engagementId: string }).engagementId}/services`, input);
export const updateService = (id: string, input: Record<string, unknown>) => patch(`/services/${id}`, input);
export const fetchAllCreds = (eid: string) => get<unknown[]>(`/engagements/${eid}/creds`);

// Findings
export const fetchFindings = (eid: string) => get<unknown[]>(`/engagements/${eid}/findings`);
export const addFinding = (input: Record<string, unknown>) => post(`/engagements/${(input as { engagementId: string }).engagementId}/findings`, input);
export const updateFinding = (id: string, input: Record<string, unknown>) => patch(`/findings/${id}`, input);

// Objectives
export const fetchObjectives = (eid: string) => get<unknown[]>(`/engagements/${eid}/objectives`);
export const captureFlag = (id: string, flag: string) => put(`/objectives/${id}/capture`, { flag });

// Evidence
export const fetchEvidence = (eid: string) => get<unknown[]>(`/engagements/${eid}/evidence`);
export const addEvidence = (input: Record<string, unknown>) => post(`/engagements/${(input as { engagementId: string }).engagementId}/evidence`, input);

// Artifacts
export const fetchArtifacts = (eid: string) => get<unknown[]>(`/engagements/${eid}/artifacts`);
export const addArtifact = (input: Record<string, unknown>) => post(`/engagements/${(input as { engagementId: string }).engagementId}/artifacts`, input);

// Activity
export const fetchActivity = (eid: string) => get<unknown[]>(`/engagements/${eid}/activity`);
export const logActivity = (input: Record<string, unknown>) => post(`/engagements/${(input as { engagementId: string }).engagementId}/activity`, input);

// Agent runs
export const fetchAgentRuns = (eid: string) => get<unknown[]>(`/engagements/${eid}/agent-runs`);

// Steps
export const fetchSteps = (eid: string) => get<unknown[]>(`/engagements/${eid}/steps`);
export const fetchNextSteps = (eid: string, max?: number) => get(`/engagements/${eid}/steps/next${max ? `?max=${max}` : ""}`);

// Playbooks
export const fetchPlaybooks = () => get<unknown[]>("/playbooks");
export const fetchPlaybook = (id: string) => get(`/playbooks/${id}`);
export const fetchDefaultPlaybook = (type: string) => get(`/playbooks/default/${type}`);
export const createPlaybook = (input: Record<string, unknown>) => post("/playbooks", input);
export const updatePlaybook = (id: string, input: Record<string, unknown>) => patch(`/playbooks/${id}`, input);

// Events
export const fetchEvents = (eid: string, type?: string) => get<unknown[]>(`/engagements/${eid}/events${type ? `?type=${type}` : ""}`);

// Discoveries
export const fetchDiscoveries = (eid: string, opts?: { category?: string; type?: string }) => {
  const params = new URLSearchParams();
  if (opts?.category) params.set("category", opts.category);
  if (opts?.type) params.set("type", opts.type);
  const qs = params.toString();
  return get<unknown[]>(`/engagements/${eid}/discoveries${qs ? `?${qs}` : ""}`);
};
export const fetchDiscoverySummary = (eid: string) => get(`/engagements/${eid}/discoveries/summary`);

// Knowledge
export const searchKnowledge = (q: string, opts?: { limit?: number; source?: string; mode?: string }) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.source) params.set("source", opts.source);
  if (opts?.mode) params.set("mode", opts.mode);
  return get<unknown[]>(`/knowledge?${params}`);
};

// Settings
export const fetchSettings = () => get<Record<string, unknown>>("/settings");
export const updateSettings = (settings: Record<string, unknown>) => put("/settings", settings);

// Messages
export const fetchMessages = (eid: string) => get<unknown[]>(`/messages?engagementId=${eid}`);
export const sendMessage = (input: Record<string, unknown>) => post("/messages", input);
