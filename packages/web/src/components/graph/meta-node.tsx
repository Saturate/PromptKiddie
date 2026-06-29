"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface MetaNodeData {
  label: string;
  phase: string;
  variant: "start" | "end" | "gate";
  isMeta: true;
}

const PHASE_COLORS: Record<string, string> = {
  recon: "border-blue-500/50 bg-blue-500/10 text-blue-400",
  enum: "border-purple-500/50 bg-purple-500/10 text-purple-400",
  exploit: "border-red-500/50 bg-red-500/10 text-red-400",
  postexploit: "border-orange-500/50 bg-orange-500/10 text-orange-400",
  report: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
};

const VARIANT_SHAPES: Record<string, string> = {
  start: "rounded-full",
  end: "rounded-full",
  gate: "rotate-45 rounded-sm",
};

export function MetaNode({ data }: NodeProps) {
  const d = data as unknown as MetaNodeData;
  const color = PHASE_COLORS[d.phase] ?? "border-border bg-muted text-muted-foreground";

  if (d.variant === "gate") {
    return (
      <div className="flex items-center justify-center w-[50px] h-[50px]">
        <Handle type="target" position={Position.Top} id="top" className="!bg-border !w-2 !h-2" />
        <Handle type="target" position={Position.Left} id="left" className="!bg-border !w-2 !h-2" />
        <div className={`w-[36px] h-[36px] border-2 flex items-center justify-center ${color} ${VARIANT_SHAPES.gate}`}>
          <span className="text-[10px] font-mono font-bold -rotate-45">?</span>
        </div>
        <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-border !w-2 !h-2" />
        <Handle type="source" position={Position.Right} id="right" className="!bg-border !w-2 !h-2" />
      </div>
    );
  }

  return (
    <div className={`rounded-full border-2 px-5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-center min-w-[140px] ${color}`}>
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      {d.label}
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />
    </div>
  );
}
