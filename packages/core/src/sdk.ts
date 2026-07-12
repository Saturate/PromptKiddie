/**
 * PK Playbook SDK
 *
 * Playbooks are TypeScript modules exporting Action arrays.
 * The supervisor evaluates actions on engagement events.
 * Shared steps are just imported functions.
 */

export interface EngagementEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source: string;
  engagementId: string;
  createdAt: Date;
}

export interface EngagementState {
  id: string;
  name: string;
  type: string;
  target: string;
  phase: string;
  mode: string;
}

export interface ExecOpts {
  stream?: boolean;
  timeout?: number;
  maxOutput?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
}

export interface ExploitHit {
  cve: string;
  product: string;
  affected: string;
  cvss: number;
  severity: string;
  pocPath?: string;
  source: string;
}

export interface KnowledgeResult {
  content: string;
  source: string;
  score: number;
}

export interface LlmOpts {
  agentType?: string;
  priority?: number;
  model?: string;
}

export interface RunContext {
  target: string;
  event: EngagementEvent;
  engagement: EngagementState;

  exec(tool: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
  emit(type: string, payload: Record<string, unknown>): Promise<void>;

  searchExploitIndex(product: string, version: string): Promise<ExploitHit[]>;
  searchKnowledge(query: string): Promise<KnowledgeResult[]>;

  reprioritize(actionName: string, newPriority: number): void;
  spawnLlm(task: string, opts?: LlmOpts): Promise<string>;

  discover(type: "positive" | "negative" | "attempted", category: string, summary: string, detail?: Record<string, unknown>): Promise<void>;
  evidence(path: string, type: "screenshot" | "scan" | "output" | "file" | "flag"): Promise<void>;
  readFile(path: string): Promise<string>;
  log(message: string): void;
}

export type Tier = "auto" | "llm" | "both";

export interface Action {
  name: string;
  description?: string;
  on: (event: EngagementEvent) => boolean;
  run: (ctx: RunContext) => Promise<void>;
  tier?: Tier;
  emits?: string[];
}

export interface Playbook {
  name: string;
  description: string;
  actions: Action[];
}

export interface MockExecMap {
  [command: string]: ExecResult;
}

export interface MockContextOpts {
  target?: string;
  event?: Partial<EngagementEvent>;
  engagement?: Partial<EngagementState>;
  execResults?: MockExecMap;
}

export interface MockContext extends RunContext {
  emitted: Array<{ type: string; payload: Record<string, unknown> }>;
  discoveries: Array<{ type: string; category: string; summary: string; detail?: Record<string, unknown> }>;
  evidenceFiles: Array<{ path: string; type: string }>;
  logs: string[];
  reprioritized: Array<{ name: string; priority: number }>;
  llmCalls: Array<{ task: string; opts?: LlmOpts }>;
  filesRead: string[];
}

export function createMockContext(opts: MockContextOpts = {}): MockContext {
  const emitted: MockContext["emitted"] = [];
  const discoveries: MockContext["discoveries"] = [];
  const evidenceFiles: MockContext["evidenceFiles"] = [];
  const logs: string[] = [];
  const reprioritized: MockContext["reprioritized"] = [];
  const llmCalls: MockContext["llmCalls"] = [];
  const filesRead: string[] = [];

  const event: EngagementEvent = {
    id: "mock-event-id",
    type: opts.event?.type ?? "EngagementStarted",
    payload: opts.event?.payload ?? {},
    source: opts.event?.source ?? "mock",
    engagementId: opts.engagement?.id ?? "mock-engagement-id",
    createdAt: new Date(),
    ...opts.event,
  };

  const engagement: EngagementState = {
    id: "mock-engagement-id",
    name: "Mock Engagement",
    type: "ctf",
    target: opts.target ?? "10.0.0.1",
    phase: "recon",
    mode: "standard",
    ...opts.engagement,
  };

  return {
    target: opts.target ?? "10.0.0.1",
    event,
    engagement,
    emitted,
    discoveries,
    evidenceFiles,
    logs,
    reprioritized,
    llmCalls,
    filesRead,

    async exec(tool, args, _opts) {
      const cmd = `${tool} ${args.join(" ")}`;
      const match = opts.execResults?.[tool] ?? opts.execResults?.[cmd];
      if (match) return match;
      return { stdout: "", stderr: `mock: ${cmd} not configured`, code: 1, durationMs: 0 };
    },

    async emit(type, payload) {
      emitted.push({ type, payload });
    },

    async searchExploitIndex(_product, _version) {
      return [];
    },

    async searchKnowledge(_query) {
      return [];
    },

    reprioritize(name, priority) {
      reprioritized.push({ name, priority });
    },

    async spawnLlm(task, llmOpts) {
      llmCalls.push({ task, opts: llmOpts });
      return "mock-llm-response";
    },

    async discover(type, category, summary, detail) {
      discoveries.push({ type, category, summary, detail });
    },

    async evidence(path, type) {
      evidenceFiles.push({ path, type });
    },

    async readFile(path) {
      filesRead.push(path);
      return `mock file content for ${path}`;
    },

    log(message) {
      logs.push(message);
    },
  };
}
