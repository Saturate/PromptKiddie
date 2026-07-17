
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PlaybookGraph } from "./playbook-graph";

interface Step {
  id: string;
  stepKey: string;
  title: string;
  status: string;
  nodeType: string;
  dependsOn: string[] | null;
  priority: number;
  condition?: string | null;
  agentId?: string | null;
  phase: string;
  positionX: number;
  positionY: number;
  skipReason?: string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
}

export function PlaybookView({
  steps,
  defaultCollapsed = false,
}: {
  steps: Step[];
  defaultCollapsed?: boolean;
}) {
  const [view, setView] = useState<"list" | "graph">("list");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showSkipped, setShowSkipped] = useState(true);

  const phases = [...new Set(steps.map((s) => s.phase))];
  const doneCount = steps.filter((s) => s.status === "done").length;
  const skippedCount = steps.filter((s) => s.status === "skipped").length;
  const totalCount = steps.length;
  const completedCount = doneCount + skippedCount;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const currentPhase = phases.find((p) => steps.some((s) => s.phase === p && s.status !== "done" && s.status !== "skipped")) ?? phases[0];

  // Prefer completion time; fall back to start time for running/pending steps.
  const stepTime = (step: Step): string | null => {
    const ts = step.completedAt ?? step.startedAt;
    if (!ts) return null;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString();
  };

  const PHASE_COLORS: Record<string, string> = {
    recon: "text-blue-400",
    enum: "text-purple-400",
    exploit: "text-red-400",
    postexploit: "text-orange-400",
    report: "text-emerald-400",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 group"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
          )}
          <span className="text-sm font-mono font-semibold">
            Playbook <span className="text-muted-foreground">({completedCount}/{totalCount} complete{skippedCount ? ` (${skippedCount} skipped)` : ""})</span>
          </span>
          <span className="font-mono text-xs text-pk-amber font-bold">{pct}%</span>
        </button>
        {!collapsed && (
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setView("list")}
              className={`font-mono text-[10px] px-2 py-0.5 rounded transition-colors ${view === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              List
            </button>
            <button
              onClick={() => setView("graph")}
              className={`font-mono text-[10px] px-2 py-0.5 rounded transition-colors ${view === "graph" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              Graph
            </button>
          </div>
        )}
      </div>

      {collapsed ? null : (
      <>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
        <div className="h-full bg-pk-amber transition-all" style={{ width: `${pct}%` }} />
      </div>

      {view === "list" && skippedCount > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setShowSkipped((s) => !s)}
            className="font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showSkipped ? "Hide" : "Show"} skipped ({skippedCount})
          </button>
        </div>
      )}

      {view === "graph" ? (
        <PlaybookGraph steps={steps} />
      ) : (
        <div className="space-y-4">
          {phases.map((phaseName) => {
            const phaseSteps = steps.filter((s) => s.phase === phaseName);
            const visibleSteps = showSkipped
              ? phaseSteps
              : phaseSteps.filter((s) => s.status !== "skipped");
            if (visibleSteps.length === 0) return null;
            const phaseDone = phaseSteps.filter((s) => s.status === "done" || s.status === "skipped").length;
            const isCurrentPhase = phaseName === currentPhase;
            return (
              <div key={phaseName}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`font-mono text-[10px] uppercase tracking-wider font-semibold ${isCurrentPhase ? "text-pk-amber" : (PHASE_COLORS[phaseName] ?? "text-muted-foreground")}`}>
                    {phaseName}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">{phaseDone}/{phaseSteps.length}</span>
                  {isCurrentPhase && <span className="h-1.5 w-1.5 rounded-full bg-pk-amber animate-pulse" />}
                </div>
                <div className="space-y-1 ml-1">
                  {visibleSteps.map((step) => (
                    <div
                      key={step.id}
                      className={`flex items-start gap-2 py-1 px-2 rounded text-xs font-mono ${
                        step.status === "done" ? "text-muted-foreground" :
                        step.status === "skipped" ? "text-muted-foreground/50 line-through" :
                        step.status === "running" ? "text-foreground bg-pk-amber/5" :
                        isCurrentPhase ? "text-foreground" : "text-muted-foreground/60"
                      }`}
                    >
                      <span className="mt-0.5 shrink-0">
                        {step.status === "done" ? (
                          <span className="text-emerald-400">&#10003;</span>
                        ) : step.status === "skipped" ? (
                          <span className="text-muted-foreground/40">&#8212;</span>
                        ) : step.status === "running" ? (
                          <span className="text-pk-amber animate-pulse">&#9679;</span>
                        ) : (
                          <span className="text-muted-foreground/30">&#9675;</span>
                        )}
                      </span>
                      <span className="flex-1">{step.title}</span>
                      {step.dependsOn && step.dependsOn.length > 0 && (
                        <span className="text-[9px] text-muted-foreground/30">{step.dependsOn.length} deps</span>
                      )}
                      {step.skipReason && (
                        <span className="text-[9px] text-muted-foreground/40 italic truncate max-w-[150px]" title={step.skipReason}>
                          {step.skipReason}
                        </span>
                      )}
                      {stepTime(step) && (
                        <span className="text-[9px] text-muted-foreground/40 shrink-0 tabular-nums">
                          {stepTime(step)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
