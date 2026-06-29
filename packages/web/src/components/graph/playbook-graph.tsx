"use client";

import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { StepNode, type StepNodeData } from "./step-node";
import { MetaNode, type MetaNodeData } from "./meta-node";
import { layoutGraph } from "./layout";
import { useMemo } from "react";

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

const nodeTypes = { step: StepNode, meta: MetaNode };

function buildGraph(steps: StepRow[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const idByKey = new Map(steps.map((s) => [s.stepKey, s.id]));

  for (const step of steps) {
    const isMeta = step.nodeType === "sequence" || step.stepKey.endsWith(".start") || step.stepKey.endsWith(".end");

    if (isMeta) {
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
          status: step.status,
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
      edges.push({
        id: `${srcId}-${step.id}`,
        source: srcId,
        target: step.id,
        animated: step.status === "running",
        style: {
          stroke: step.status === "running" ? "#e8a040" : step.status === "done" ? "#50b880" : "#3a4260",
          strokeWidth: 1.5,
        },
        type: "smoothstep",
      });
    }
  }

  return layoutGraph(nodes, edges, "TB");
}

export function PlaybookGraph({ steps, className }: PlaybookGraphProps) {
  const { nodes, edges } = useMemo(() => buildGraph(steps), [steps]);

  return (
    <div className={`w-full h-[500px] rounded-lg border border-border bg-background ${className ?? ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#232a3f" />
        <Controls className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground" />
      </ReactFlow>
    </div>
  );
}
