"use client";

import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StepNode, type StepNodeData } from "./step-node";
import { MetaNode, type MetaNodeData } from "./meta-node";
import { ControlNode, type ControlNodeData } from "./control-node";
import { layoutGraph } from "./layout";
import { useEffect, useMemo, useRef } from "react";

const PHASE_ORDER = ["scoping", "recon", "enum", "exploit", "postexploit", "report"];

/**
 * The nodes to zoom in on by default: whatever is actively in play. Running steps
 * take precedence; otherwise the not-yet-done steps of the earliest incomplete
 * phase. Empty (e.g. a finished engagement) means "show everything".
 */
function focusStepIds(steps: StepRow[]): string[] {
  const running = steps.filter((s) => s.status === "running");
  if (running.length > 0) return running.map((s) => s.id);

  const incomplete = steps.filter((s) => s.status !== "done" && s.status !== "skipped");
  if (incomplete.length === 0) return [];

  const currentPhase =
    PHASE_ORDER.find((p) => incomplete.some((s) => s.phase === p)) ?? incomplete[0].phase;
  return incomplete.filter((s) => s.phase === currentPhase).map((s) => s.id);
}

/**
 * Zooms to the focus nodes once per distinct focus target. Keyed on focusKey so
 * the 5s AutoRefresh (which re-renders with fresh step data) doesn't fight a user
 * who has panned/zoomed manually; it only re-frames when the active step changes.
 */
function FocusController({ focusIds, focusKey }: { focusIds: string[]; focusKey: string }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!initialized || lastKey.current === focusKey) return;
    lastKey.current = focusKey;
    if (focusIds.length > 0) {
      fitView({ nodes: focusIds.map((id) => ({ id })), maxZoom: 1, padding: 0.5, duration: 400 });
    } else {
      fitView({ maxZoom: 0.9, padding: 0.15, duration: 400 });
    }
  }, [initialized, focusKey, focusIds, fitView]);

  return null;
}

interface StepRow {
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
}

interface PlaybookGraphProps {
  steps: StepRow[];
  className?: string;
}

const nodeTypes = { step: StepNode, meta: MetaNode, control: ControlNode };

function buildGraph(steps: StepRow[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const idByKey = new Map(steps.map((s) => [s.stepKey, s.id]));

  for (const step of steps) {
    const isMeta = step.nodeType === "sequence" || step.stepKey.endsWith(".start") || step.stepKey.endsWith(".end");

    const isControl = step.nodeType === "parallel" || step.nodeType === "selector";
    if (isControl) {
      nodes.push({
        id: step.id,
        type: "control",
        position: { x: 0, y: 0 },
        data: {
          label: step.title,
          variant: step.nodeType as "parallel" | "selector",
          phase: step.phase,
          isMeta: true,
        } satisfies ControlNodeData,
      });
    } else if (isMeta) {
      nodes.push({
        id: step.id,
        type: "meta",
        position: { x: 0, y: 0 },
        data: {
          label: step.title,
          phase: step.phase,
          variant: step.stepKey.endsWith(".start") ? "start" : "end",
          isMeta: true,
        } satisfies MetaNodeData,
      });
    } else {
      nodes.push({
        id: step.id,
        type: "step",
        position: { x: 0, y: 0 },
        data: {
          title: step.title,
          stepKey: step.stepKey,
          status: step.status as StepNodeData["status"],
          nodeType: step.nodeType,
          type: step.stepKey.includes("scan") || step.stepKey.includes("fuzz") || step.stepKey.includes("exec") || step.stepKey.includes("curl") || step.stepKey.includes("nmap") || step.stepKey.includes("enum4linux") ? "mechanical" : "judgment",
          priority: step.priority,
          agentId: step.agentId,
          phase: step.phase,
        } satisfies StepNodeData,
      });
    }

    for (const dep of step.dependsOn ?? []) {
      const srcId = idByKey.get(dep);
      if (!srcId) continue;
      const color = step.status === "running" ? "#e8a040" : step.status === "done" ? "#50b880" : "#3a4260";
      edges.push({
        id: `${srcId}-${step.id}`,
        source: srcId,
        target: step.id,
        animated: step.status === "running",
        style: { stroke: color, strokeWidth: 1.5 },
        type: "smoothstep",
        markerEnd: { type: "arrowclosed" as const, width: 12, height: 12, color },
      });
    }
  }

  return layoutGraph(nodes, edges, "TB");
}

export function PlaybookGraph({ steps, className }: PlaybookGraphProps) {
  const { nodes, edges } = useMemo(() => buildGraph(steps), [steps]);
  const focusIds = useMemo(() => focusStepIds(steps), [steps]);
  const focusKey = useMemo(() => [...focusIds].sort().join(","), [focusIds]);

  return (
    <div className={`w-full h-[500px] rounded-lg border border-border bg-background ${className ?? ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <FocusController focusIds={focusIds} focusKey={focusKey} />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#232a3f" />
        <Controls className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground" />
      </ReactFlow>
    </div>
  );
}
