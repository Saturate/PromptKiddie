
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ActionNode, type ActionNodeData, type CoverageStatus } from "./action-node";
import { layoutGraph } from "./layout";
import { useCallback, useMemo } from "react";
import type { ActionGraph, ActionEdge } from "@promptkiddie/core";
import type { ActionNodeWithState } from "@/hooks/graph-helpers";

interface ActionGraphProps {
  graph: ActionGraph & { nodes: ActionNodeWithState[] };
  activeNodes?: Set<string>;
  doneNodes?: Set<string>;
  activeEdges?: Set<string>;
  coverage?: Record<string, CoverageStatus>;
  onNodeClick?: (nodeId: string, data: ActionNodeData) => void;
  className?: string;
}

const nodeTypes = { action: ActionNode };

function buildFlowGraph(
  graph: ActionGraphProps["graph"],
  activeNodes?: Set<string>,
  doneNodes?: Set<string>,
  activeEdges?: Set<string>,
  coverage?: Record<string, CoverageStatus>,
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
      running: activeNodes?.has(n.id) ? Math.max((n as unknown as { running: number }).running ?? 0, 1) : (n as unknown as { running: number }).running ?? 0,
      eventCount: (n as unknown as { eventCount: number }).eventCount ?? 0,
      coverage: coverage?.[n.name],
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

export function ActionGraphView({ graph, activeNodes, doneNodes, activeEdges, coverage, onNodeClick, className }: ActionGraphProps) {
  const { nodes, edges } = useMemo(
    () => buildFlowGraph(graph, activeNodes, doneNodes, activeEdges, coverage),
    [graph, activeNodes, doneNodes, activeEdges, coverage],
  );

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.id === "__start__") return;
    onNodeClick?.(node.id, node.data as unknown as ActionNodeData);
  }, [onNodeClick]);

  return (
    <div className={`w-full h-[600px] rounded-lg border border-border bg-background ${className ?? ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
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
