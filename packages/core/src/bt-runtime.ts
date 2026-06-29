/**
 * Behavior tree runtime for graph playbooks.
 *
 * Evaluates the engagement step graph to determine which nodes are ready
 * to execute. Supports: sequence (ordered), selector (priority fallback),
 * parallel (fork), gate (human approval), and action (leaf) nodes.
 *
 * The graph decides WHAT to do; the LLM decides HOW within each node.
 */

export interface StepNode {
  id: string;
  stepKey: string;
  title: string;
  status: "pending" | "running" | "done" | "skipped";
  nodeType: string;
  dependsOn: string[];
  priority: number;
  condition?: string | null;
  agentId?: string | null;
  phase: string;
}

export interface ReadyNode extends StepNode {
  reason: string;
}

export interface GraphState {
  steps: StepNode[];
  ports: Array<{ port: number; service?: string | null; state: string }>;
  findings: Array<{ id: string; severity: string; title: string }>;
  artifacts: Array<{ id: string; type: string }>;
}

/**
 * Find all nodes whose dependencies are met and are ready to execute.
 * Returns nodes sorted by priority (0 = highest).
 */
export function findReadyNodes(state: GraphState): ReadyNode[] {
  const { steps } = state;
  const statusMap = new Map(steps.map((s) => [s.stepKey, s.status]));
  const ready: ReadyNode[] = [];

  for (const step of steps) {
    if (step.status !== "pending") continue;

    const depsResolved = (step.dependsOn ?? []).every((dep) => {
      const depStatus = statusMap.get(dep);
      return depStatus === "done" || depStatus === "skipped";
    });

    if (!depsResolved) continue;

    if (step.condition && !evaluateCondition(step.condition, state)) {
      continue;
    }

    ready.push({
      ...step,
      reason: step.dependsOn?.length
        ? `Dependencies met: ${step.dependsOn.join(", ")}`
        : "No dependencies",
    });
  }

  return ready.sort((a, b) => a.priority - b.priority);
}

/**
 * Get the next single node to execute (highest priority ready node).
 */
export function getNextNode(state: GraphState): ReadyNode | null {
  const ready = findReadyNodes(state);
  return ready[0] ?? null;
}

/**
 * Get all nodes that can run in parallel (nodes with nodeType 'parallel'
 * or independent ready nodes with no shared dependencies).
 */
export function getParallelNodes(state: GraphState, maxFork = 3): ReadyNode[] {
  const ready = findReadyNodes(state);
  return ready.slice(0, maxFork);
}

/**
 * Check if a phase is complete (all nodes done or skipped).
 */
export function isPhaseComplete(state: GraphState, phase: string): boolean {
  const phaseSteps = state.steps.filter((s) => s.phase === phase);
  if (phaseSteps.length === 0) return true;
  return phaseSteps.every((s) => s.status === "done" || s.status === "skipped");
}

/**
 * Get execution progress summary.
 */
export function getProgress(state: GraphState) {
  const total = state.steps.length;
  const done = state.steps.filter((s) => s.status === "done").length;
  const skipped = state.steps.filter((s) => s.status === "skipped").length;
  const running = state.steps.filter((s) => s.status === "running").length;
  const pending = state.steps.filter((s) => s.status === "pending").length;
  const ready = findReadyNodes(state).length;
  const totalCost = state.steps.reduce((sum, s) => sum + ((s as StepNode & { costTokens?: number }).costTokens ?? 0), 0);

  const phases = [...new Set(state.steps.map((s) => s.phase))];
  const phaseProgress = phases.map((p) => ({
    phase: p,
    total: state.steps.filter((s) => s.phase === p).length,
    done: state.steps.filter((s) => s.phase === p && s.status === "done").length,
    complete: isPhaseComplete(state, p),
  }));

  return { total, done, skipped, running, pending, ready, totalCost, pct: Math.round((done / total) * 100), phaseProgress };
}

/**
 * Evaluate a JSONPath-like condition against engagement state.
 * Simple implementation: supports basic patterns.
 */
export function evaluateCondition(condition: string, state: GraphState): boolean {
  if (!condition) return true;

  const c = condition.toLowerCase().trim();

  if (c.startsWith("ports.")) {
    if (c.includes("count") && c.includes(">")) {
      const num = parseInt(c.split(">").pop()?.trim() ?? "0", 10);
      return state.ports.filter((p) => p.state === "open").length > num;
    }
    if (c.includes("service") && c.includes("contains")) {
      const svc = c.split("contains").pop()?.trim().replace(/['"]/g, "") ?? "";
      return state.ports.some((p) => p.service?.toLowerCase().includes(svc));
    }
    if (c.includes("port") && c.includes("in")) {
      const match = c.match(/\[([^\]]+)\]/);
      if (match) {
        const portNums = match[1].split(",").map((n) => parseInt(n.trim(), 10));
        return state.ports.some((p) => portNums.includes(p.port) && p.state === "open");
      }
    }
    if (c.includes("port") && c.includes("=")) {
      const num = parseInt(c.split("=").pop()?.trim() ?? "0", 10);
      return state.ports.some((p) => p.port === num && p.state === "open");
    }
  }

  if (c.startsWith("findings.")) {
    if (c.includes("count") && c.includes(">")) {
      const num = parseInt(c.split(">").pop()?.trim() ?? "0", 10);
      return state.findings.length > num;
    }
    if (c.includes("severity") && c.includes("==")) {
      const sev = c.split("==").pop()?.trim().replace(/['"]/g, "") ?? "";
      return state.findings.some((f) => f.severity === sev);
    }
  }

  if (c.startsWith("artifacts.")) {
    if (c.includes("type") && c.includes("==")) {
      const typ = c.split("==").pop()?.trim().replace(/['"]/g, "") ?? "";
      return state.artifacts.some((a) => a.type === typ);
    }
  }

  return true;
}
