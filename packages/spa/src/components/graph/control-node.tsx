
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface ControlNodeData {
  label: string;
  variant: "parallel" | "selector" | "join";
  phase: string;
  isMeta: true;
}

const VARIANT_STYLES: Record<string, { icon: string; bg: string; shape: string }> = {
  parallel: {
    icon: "⫽",
    bg: "border-amber-500/40 bg-amber-500/8 text-amber-400",
    shape: "rounded-lg",
  },
  selector: {
    icon: "?",
    bg: "border-purple-500/40 bg-purple-500/8 text-purple-400",
    shape: "rotate-45 rounded-sm",
  },
  join: {
    icon: "⋈",
    bg: "border-emerald-500/40 bg-emerald-500/8 text-emerald-400",
    shape: "rounded-lg",
  },
};

export function ControlNode({ data }: NodeProps) {
  const d = data as unknown as ControlNodeData;
  const style = VARIANT_STYLES[d.variant] ?? VARIANT_STYLES.parallel;

  if (d.variant === "selector") {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <Handle type="target" position={Position.Top} id="top" className="pk-handle" />
        <Handle type="target" position={Position.Left} id="left" className="pk-handle" />
        <div className={`w-[40px] h-[40px] border-2 flex items-center justify-center ${style.bg} ${style.shape}`}>
          <span className="text-sm font-mono font-bold -rotate-45">{style.icon}</span>
        </div>
        <span className="font-mono text-[8px] text-muted-foreground mt-0.5">{d.label}</span>
        <Handle type="source" position={Position.Bottom} id="bottom" className="pk-handle" />
        <Handle type="source" position={Position.Right} id="right" className="pk-handle" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <Handle type="target" position={Position.Top} id="top" className="pk-handle" />
      <Handle type="target" position={Position.Left} id="left" className="pk-handle" />
      <div className={`border-2 px-4 py-1.5 flex items-center gap-2 font-mono text-[10px] font-semibold ${style.bg} ${style.shape}`}>
        <span className="text-sm">{style.icon}</span>
        <span>{d.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" className="pk-handle" />
      <Handle type="source" position={Position.Right} id="right" className="pk-handle" />
    </div>
  );
}
