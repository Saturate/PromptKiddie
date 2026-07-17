/**
 * Real RunContext implementation for the supervisor.
 * Executes commands via pk exec, emits events to DB via repo, searches knowledge base.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  searchKnowledge as searchKB,
  type Repo,
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
  repo: Repo;
  actionName?: string;
  onReprioritize?: (actionName: string, priority: number) => void;
  onOutput?: (line: string) => void;
  signal?: AbortSignal;
}

export function createRunContext(opts: RunContextOpts): RunContext {
  const { engagementId, target, event, engagement, repo, actionName, onReprioritize, onOutput, signal } = opts;
  const actorLabel = actionName ?? "supervisor";

  return {
    target,
    event,
    engagement,

    async exec(tool: string, args: string[], execOpts?: ExecOpts): Promise<ExecResult> {
      const start = Date.now();
      const cmdStr = `${tool} ${args.join(" ")}`;

      const blocked = await repo.isExecBlocked(engagementId, cmdStr, target);
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
            const code = err && "code" in err && typeof err.code === "number" ? err.code : err ? 1 : 0;
            const durationMs = Date.now() - start;

            repo.recordExecOutcome(engagementId, cmdStr, target, code).catch(() => {});

            repo.logActivity({
              engagementId,
              phase: engagement.phase as "recon" | "enum" | "exploit" | "postexploit" | "report" | "scoping",
              action: `[${actorLabel}] ${tool} (${durationMs}ms, exit ${code})`,
              command: cmdStr,
              actor: "agent" as const,
            }).catch(() => {});

            resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code, durationMs });
          },
        );

        if (execOpts?.stream && proc.stdout) {
          proc.stdout.on("data", (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
              if (line.trim()) onOutput?.(line);
            }
          });
        }
        if (execOpts?.stream && proc.stderr) {
          proc.stderr.on("data", (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
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
      await repo.emitEvent(engagementId, type, payload, "supervisor");
    },

    async searchExploitIndex(_product: string, _version: string): Promise<ExploitHit[]> {
      const results = await searchKB(`${_product} ${_version} CVE exploit`, { limit: 5 });
      return results
        .filter((r) => {
          const meta = r as unknown as { source: string };
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
      console.log(`[supervisor] LLM task: ${task.slice(0, 100)}...`);
      await repo.sendMessage({
        engagementId,
        direction: "outbound",
        author: "supervisor",
        body: `[LLM task] ${_llmOpts?.agentType ?? "general-purpose"}: ${task}`,
      });
      await repo.addAgentLog({
        engagementId,
        agent: "supervisor",
        phase: engagement.phase as "recon" | "enum" | "exploit" | "postexploit" | "report" | "scoping",
        message: `LLM task sent to inbox: ${task.slice(0, 200)}`,
        category: "llm-task",
      });
      return "Task sent to orchestrator inbox";
    },

    async discover(type: "positive" | "negative" | "attempted", category: string, summary: string, detail?: Record<string, unknown>): Promise<void> {
      await repo.addDiscovery({ engagementId, type, category, summary, detail });
    },

    async evidence(path: string, type: "screenshot" | "scan" | "output" | "file" | "flag"): Promise<void> {
      const slug = engagement.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const fullPath = path.startsWith("engagements/") ? path : `engagements/${slug}/${path}`;
      await repo.addEvidence({ engagementId, path: fullPath, type }).catch(() => {});
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
      repo.addAgentLog({
        engagementId,
        agent: "supervisor",
        phase: engagement.phase as "recon" | "enum" | "exploit" | "postexploit" | "report" | "scoping",
        message,
        category: "progress",
      }).catch(() => {});
    },
  };
}
