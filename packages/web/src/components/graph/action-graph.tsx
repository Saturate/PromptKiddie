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
import { ActionNode, type ActionNodeData } from "./action-node";
import { layoutGraph } from "./layout";
import { useMemo } from "react";
import type { ActionGraph, ActionEdge, ActionNode as ActionNodeType } from "@promptkiddie/core";

interface ActionNodeWithState extends ActionNodeType {
  running: number;
  eventCount: number;
}

interface ActionGraphProps {
  graph: ActionGraph & { nodes: ActionNodeWithState[] };
  /** Set of node IDs currently active (for simulation highlighting) */
  activeNodes?: Set<string>;
  /** Set of node IDs that are "done" in the simulation */
  doneNodes?: Set<string>;
  /** Set of edge keys ("from->to") currently animated */
  activeEdges?: Set<string>;
  className?: string;
}

const nodeTypes = { action: ActionNode };

function buildFlowGraph(
  graph: ActionGraphProps["graph"],
  activeNodes?: Set<string>,
  doneNodes?: Set<string>,
  activeEdges?: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    type: "action",
    position: { x: 0, y: 0 },
    data: {
      name: n.name,
      description: n.description,
      kind: n.kind,
      emits: n.emits,
      running: activeNodes?.has(n.id) ? Math.max(n.running, 1) : n.running,
      eventCount: n.eventCount,
    } satisfies ActionNodeData,
  }));

  const edges: Edge[] = graph.edges.map((e: ActionEdge) => {
    const edgeKey = `${e.from}->${e.to}`;
    const isActive = activeNodes?.has(e.to) || activeEdges?.has(edgeKey);
    const isDone = doneNodes?.has(e.from) && doneNodes?.has(e.to);

    const color = isActive ? "#e8a040" : isDone ? "#50b880" : "#3a4260";
    return {
      id: `${e.from}-${e.to}-${e.event}`,
      source: e.from,
      target: e.to,
      label: e.event,
      labelStyle: { fontSize: 9, fill: color, fontFamily: "var(--font-mono)" },
      labelBgStyle: { fill: "transparent" },
      animated: isActive,
      style: { stroke: color, strokeWidth: isActive ? 2 : 1.5 },
      type: "smoothstep",
      markerEnd: { type: "arrowclosed" as const, width: 12, height: 12, color },
    };
  });

  return layoutGraph(nodes, edges, "TB");
}

export function ActionGraphView({ graph, activeNodes, doneNodes, activeEdges, className }: ActionGraphProps) {
  const { nodes, edges } = useMemo(
    () => buildFlowGraph(graph, activeNodes, doneNodes, activeEdges),
    [graph, activeNodes, doneNodes, activeEdges],
  );

  return (
    <div className={`w-full h-[600px] rounded-lg border border-border bg-background ${className ?? ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.15}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 0.85 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#232a3f" />
        <Controls className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground" />
      </ReactFlow>
    </div>
  );
}
