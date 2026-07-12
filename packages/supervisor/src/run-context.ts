/**
 * Real RunContext implementation for the supervisor.
 * Executes commands via pk exec, emits events to DB, searches knowledge base.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  emitEvent,
  addDiscovery,
  addEvidence,
  recordExecOutcome,
  isExecBlocked,
  searchKnowledge as searchKB,
  logActivity,
  addAgentLog,
  type RunContext,
  type EngagementEvent,
  type EngagementState,
  type ExecOpts,
  type ExecResult,
  type ExploitHit,
  type KnowledgeResult,
  type LlmOpts,
} from "@promptkiddie/core";

interface RunContextOpts {
  engagementId: string;
  target: string;
  event: EngagementEvent;
  engagement: EngagementState;
  onReprioritize?: (actionName: string, priority: number) => void;
  onOutput?: (line: string) => void;
  signal?: AbortSignal;
}

export function createRunContext(opts: RunContextOpts): RunContext {
  const { engagementId, target, event, engagement, onReprioritize, onOutput, signal } = opts;

  return {
    target,
    event,
    engagement,

    async exec(tool: string, args: string[], execOpts?: ExecOpts): Promise<ExecResult> {
      const start = Date.now();
      const cmdStr = `${tool} ${args.join(" ")}`;

      const blocked = await isExecBlocked(engagementId, cmdStr, target);
      if (blocked) {
        onOutput?.(`[blocked] ${cmdStr} (failed 2+ times, skipping)`);
        return { stdout: "", stderr: "blocked by exec dedup", code: -1, durationMs: 0 };
      }

      return new Promise<ExecResult>((resolve) => {
        const proc = execFile(
          "docker",
          ["exec", "-e", "PK_EXEC=1", process.env.PK_ATTACKBOX ?? "promptkiddie-attackbox", tool, ...args],
          { maxBuffer: 10 * 1024 * 1024, timeout: execOpts?.timeout ?? 300000, signal },
          (err, stdout, stderr) => {
            const code = err && "code" in err ? (err.code as number) : err ? 1 : 0;
            const durationMs = Date.now() - start;

            recordExecOutcome(engagementId, cmdStr, target, code).catch(() => {});

            logActivity({
              engagementId,
              phase: engagement.phase as "recon" | "enum" | "exploit" | "postexploit" | "report" | "scoping",
              action: `[supervisor] ${tool} (${durationMs}ms, exit ${code})`,
              command: cmdStr,
              actor: "agent",
            }).catch(() => {});

            resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code, durationMs });
          },
        );

        if (execOpts?.stream && proc.stdout) {
          proc.stdout.on("data", (chunk: Buffer) => {
            const lines = chunk.toString().split("\n");
            for (const line of lines) {
              if (line.trim()) onOutput?.(line);
            }
          });
        }
        if (execOpts?.stream && proc.stderr) {
          proc.stderr.on("data", (chunk: Buffer) => {
            const lines = chunk.toString().split("\n");
            for (const line of lines) {
              if (line.trim()) onOutput?.(line);
            }
          });
        }

        proc.on("error", (err) => {
          resolve({ stdout: "", stderr: err.message, code: 1, durationMs: Date.now() - start });
        });
      });
    },

    async emit(type: string, payload: Record<string, unknown>): Promise<void> {
      await emitEvent(engagementId, type, payload, "supervisor");
    },

    async searchExploitIndex(_product: string, _version: string): Promise<ExploitHit[]> {
      const results = await searchKB(`${_product} ${_version} CVE exploit`, { limit: 5 });
      return results
        .filter((r) => {
          const meta = r as unknown as { source: string; category?: string };
          return meta.source === "pk-exploits";
        })
        .map((r) => ({
          cve: "unknown",
          product: _product,
          affected: "unknown",
          cvss: 0,
          severity: "unknown",
          source: r.source,
        }));
    },

    async searchKnowledge(query: string): Promise<KnowledgeResult[]> {
      return searchKB(query, { limit: 5 });
    },

    reprioritize(actionName: string, newPriority: number): void {
      onReprioritize?.(actionName, newPriority);
    },

    async spawnLlm(task: string, _llmOpts?: LlmOpts): Promise<string> {
      const { sendMessage } = await import("@promptkiddie/core");
      console.log(`[supervisor] LLM task: ${task.slice(0, 100)}...`);
      await sendMessage({
        engagementId,
        direction: "outbound",
        author: "supervisor",
        body: `[LLM task] ${_llmOpts?.agentType ?? "general-purpose"}: ${task}`,
      });
      await addAgentLog({
        engagementId,
        agent: "supervisor",
        phase: engagement.phase as "recon" | "enum" | "exploit" | "postexploit" | "report" | "scoping",
        message: `LLM task sent to inbox: ${task.slice(0, 200)}`,
        category: "llm-task",
      });
      return "Task sent to orchestrator inbox";
    },

    async discover(type: "positive" | "negative" | "attempted", category: string, summary: string, detail?: Record<string, unknown>): Promise<void> {
      await addDiscovery({ engagementId, type, category, summary, detail });
    },

    async evidence(path: string, type: "screenshot" | "scan" | "output" | "file" | "flag"): Promise<void> {
      // Ensure path is relative to the engagement directory
      const slug = engagement.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const fullPath = path.startsWith("engagements/") ? path : `engagements/${slug}/${path}`;
      await addEvidence({ engagementId, path: fullPath, type }).catch(() => {});
    },

    async readFile(path: string): Promise<string> {
      try {
        return await readFile(path, "utf-8");
      } catch {
        const result = await new Promise<string>((resolve) => {
          execFile(
            "docker",
            ["exec", process.env.PK_ATTACKBOX ?? "promptkiddie-attackbox", "cat", path],
            { maxBuffer: 5 * 1024 * 1024 },
            (err, stdout) => resolve(stdout ?? ""),
          );
        });
        return result;
      }
    },

    log(message: string): void {
      console.log(`[action] ${message}`);
      onOutput?.(message);
      addAgentLog({
        engagementId,
        agent: "supervisor",
        phase: engagement.phase as "recon" | "enum" | "exploit" | "postexploit" | "report" | "scoping",
        message,
        category: "progress",
      }).catch(() => {});
    },
  };
}
