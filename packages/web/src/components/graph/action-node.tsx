"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export type CoverageStatus = "pass" | "fail" | "untested" | undefined;

export interface ActionNodeData {
  name: string;
  description?: string;
  kind: "script" | "agent" | "both";
  emits: string[];
  running: number;
  eventCount: number;
  coverage?: CoverageStatus;
}

const KIND_BADGE: Record<string, { label: string; color: string }> = {
  script: { label: "script", color: "text-blue-400 bg-blue-500/10" },
  agent: { label: "agent", color: "text-amber-400 bg-amber-500/10" },
  both: { label: "both", color: "text-purple-400 bg-purple-500/10" },
};

export function ActionNode({ data }: NodeProps) {
  const d = data as unknown as ActionNodeData;
  const badge = KIND_BADGE[d.kind] ?? KIND_BADGE.script;
  const isRunning = d.running > 0;
  const isStart = d.name === "Start";

  if (isStart) {
    return (
      <div className="rounded-full border-2 border-pk-amber/50 bg-pk-amber/10 px-5 py-1.5 font-mono text-xs font-semibold text-pk-amber uppercase tracking-wider text-center min-w-[100px]">
        <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
        <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
        Start
        <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
        <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />
      </div>
    );
  }

  const coverageBorder = !isRunning && d.coverage === "pass"
    ? "border-emerald-500/40 bg-card"
    : !isRunning && d.coverage === "fail"
    ? "border-red-500/40 bg-card"
    : null;

  const borderStyle = isRunning
    ? "border-pk-amber bg-pk-amber/5 shadow-[0_0_12px_rgba(232,160,64,0.15)]"
    : coverageBorder ?? "border-border bg-card";

  // Truncate description to ~60 chars
  const desc = d.description
    ? d.description.length > 60
      ? d.description.slice(0, 57) + "..."
      : d.description
    : null;

  return (
    <div className={`rounded-lg border px-3 py-2 min-w-[200px] max-w-[260px] font-mono ${borderStyle} transition-all duration-300`}>
      <Handle type="target" position={Position.Top} id="top" className="pk-handle" />
      <Handle type="target" position={Position.Left} id="left" className="pk-handle" />

      <div className="flex items-center gap-1.5 mb-1">
        {d.coverage && (
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
              d.coverage === "pass" ? "bg-emerald-400" :
              d.coverage === "fail" ? "bg-red-400" :
              "bg-muted-foreground/30"
            }`}
            title={d.coverage === "pass" ? "Tests passing" : d.coverage === "fail" ? "Tests failing" : "No tests"}
          />
        )}
        <span className="text-[10px] text-foreground font-semibold truncate">{d.name}</span>
        {isRunning && (
          <span className="ml-auto flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-pk-amber animate-pulse" />
            {d.running > 1 && (
              <span className="text-[9px] text-pk-amber font-bold">{d.running}x</span>
            )}
          </span>
        )}
      </div>

      {desc && (
        <p className="text-[10px] leading-snug text-muted-foreground mb-1.5">{desc}</p>
      )}

      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`text-[9px] px-1 py-0.5 rounded ${badge.color}`}>
          {badge.label}
        </span>
        {d.eventCount > 0 && (
          <span className="text-[9px] text-muted-foreground/60 ml-auto tabular-nums">
            {d.eventCount} events
          </span>
        )}
      </div>

      {d.emits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.emits.map((event) => (
            <span
              key={event}
              className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground/70"
            >
              {event}
            </span>
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="bottom" className="pk-handle" />
      <Handle type="source" position={Position.Right} id="right" className="pk-handle" />
    </div>
  );
}
