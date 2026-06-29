"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface StepNodeData {
  title: string;
  stepKey: string;
  status: "pending" | "running" | "done" | "skipped";
  nodeType: string;
  type: "mechanical" | "judgment";
  priority: number;
  agentId?: string | null;
  command?: string;
  phase: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "border-border bg-card",
  running: "border-pk-amber bg-pk-amber/5 shadow-[0_0_12px_rgba(232,160,64,0.15)]",
  done: "border-emerald-500/50 bg-emerald-500/5",
  skipped: "border-border/50 bg-muted/30 opacity-60",
};

const NODE_TYPE_ICONS: Record<string, string> = {
  action: "",
  sequence: "→",
  selector: "❓",
  parallel: "≡",
  gate: "⚠",
  block_ref: "▣",
};

const PHASE_COLORS: Record<string, string> = {
  recon: "bg-blue-500",
  enum: "bg-purple-500",
  exploit: "bg-red-500",
  postexploit: "bg-orange-500",
  report: "bg-emerald-500",
};

export function StepNode({ data }: NodeProps) {
  const d = data as unknown as StepNodeData;
  const statusStyle = STATUS_STYLES[d.status] ?? STATUS_STYLES.pending;
  const phaseColor = PHASE_COLORS[d.phase] ?? "bg-muted";

  return (
    <div className={`rounded-lg border px-3 py-2 min-w-[180px] max-w-[240px] font-mono ${statusStyle} transition-all duration-300`}>
      <Handle type="target" position={Position.Top} id="top" className="pk-handle" />
      <Handle type="target" position={Position.Left} id="left" className="pk-handle" />

      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${phaseColor}`} />
        {d.nodeType !== "action" && (
          <span className="text-[9px] text-muted-foreground">{NODE_TYPE_ICONS[d.nodeType]}</span>
        )}
        <span className="text-[10px] text-muted-foreground truncate">{d.stepKey}</span>
        {d.agentId && d.status === "running" && (
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-pk-amber animate-pulse" />
        )}
      </div>

      <p className={`text-xs leading-snug ${d.status === "done" ? "text-muted-foreground" : "text-foreground"}`}>
        {d.title}
      </p>

      <div className="flex items-center gap-1.5 mt-1.5">
        <span className={`text-[9px] px-1 py-0.5 rounded ${
          d.type === "mechanical"
            ? "text-blue-400 bg-blue-500/10"
            : "text-amber-400 bg-amber-500/10"
        }`}>
          {d.type}
        </span>
        <span className="text-[9px] text-muted-foreground/50">p{d.priority}</span>
        {d.status === "running" && d.agentId && (
          <span className="text-[9px] text-pk-amber ml-auto truncate max-w-[80px]">{d.agentId}</span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} id="bottom" className="pk-handle" />
      <Handle type="source" position={Position.Right} id="right" className="pk-handle" />
    </div>
  );
}
