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

const nodeTypes = { step: StepNode };

const PHASE_ORDER = ["recon", "enum", "exploit", "postexploit", "report"];

function autoLayout(steps: StepRow[]): { nodes: Node[]; edges: Edge[] } {
  const phases = [...new Set(steps.map((s) => s.phase))].sort(
    (a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b)
  );

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const X_GAP = 220;
  const Y_GAP = 90;
  const PHASE_GAP = 60;

  let currentY = 0;

  for (const phase of phases) {
    const phaseSteps = steps
      .filter((s) => s.phase === phase)
      .sort((a, b) => a.priority - b.priority);

    const depMap = new Map<string, string[]>();
    for (const s of phaseSteps) {
      depMap.set(s.stepKey, s.dependsOn?.filter((d) => phaseSteps.some((ps) => ps.stepKey === d)) ?? []);
    }

    // Topological sort within phase
    const placed = new Set<string>();
    const levels: string[][] = [];

    while (placed.size < phaseSteps.length) {
      const level: string[] = [];
      for (const s of phaseSteps) {
        if (placed.has(s.stepKey)) continue;
        const deps = depMap.get(s.stepKey) ?? [];
        if (deps.every((d) => placed.has(d))) {
          level.push(s.stepKey);
        }
      }
      if (level.length === 0) break; // prevent infinite loop on cycles
      for (const k of level) placed.add(k);
      levels.push(level);
    }

    for (let li = 0; li < levels.length; li++) {
      const level = levels[li];
      const totalWidth = (level.length - 1) * X_GAP;
      const startX = -totalWidth / 2;

      for (let ni = 0; ni < level.length; ni++) {
        const step = phaseSteps.find((s) => s.stepKey === level[ni])!;
        const x = step.positionX || (startX + ni * X_GAP);
        const y = step.positionY || (currentY + li * Y_GAP);

        nodes.push({
          id: step.id,
          type: "step",
          position: { x, y },
          data: {
            title: step.title,
            stepKey: step.stepKey,
            status: step.status,
            nodeType: step.nodeType,
            type: step.stepKey.includes("scan") || step.stepKey.includes("fuzz") || step.stepKey.includes("exec") ? "mechanical" : "judgment",
            priority: step.priority,
            agentId: step.agentId,
            phase: step.phase,
          } satisfies StepNodeData,
        });

        for (const dep of step.dependsOn ?? []) {
          const depStep = steps.find((s) => s.stepKey === dep);
          if (depStep) {
            edges.push({
              id: `${depStep.id}-${step.id}`,
              source: depStep.id,
              target: step.id,
              animated: step.status === "running",
              style: {
                stroke: step.status === "running" ? "#e8a040" : step.status === "done" ? "#50b880" : "#232a3f",
                strokeWidth: 1.5,
              },
            });
          }
        }
      }
    }

    currentY += levels.length * Y_GAP + PHASE_GAP;
  }

  return { nodes, edges };
}

export function PlaybookGraph({ steps, className }: PlaybookGraphProps) {
  const { nodes, edges } = useMemo(() => autoLayout(steps), [steps]);

  return (
    <div className={`w-full h-[500px] rounded-lg border border-border bg-background ${className ?? ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#232a3f" />
        <Controls
          className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground"
        />
      </ReactFlow>
    </div>
  );
}
