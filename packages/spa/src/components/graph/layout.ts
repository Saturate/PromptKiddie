/**
 * Dagre-based auto-layout for playbook graphs.
 * Handles phase meta-nodes, sub-graph grouping, and directional edges.
 */
import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const META_WIDTH = 260;
const META_HEIGHT = 44;

export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
): { nodes: Node[]; edges: Edge[] } {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 100,
    ranksep: 160,
    edgesep: 50,
    marginx: 60,
    marginy: 60,
  });

  for (const node of nodes) {
    const isMeta = (node.data as Record<string, unknown>)?.isMeta;
    g.setNode(node.id, {
      width: isMeta ? META_WIDTH : NODE_WIDTH,
      height: isMeta ? META_HEIGHT : NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  Dagre.layout(g);

  const layouted = nodes.map((node) => {
    const pos = g.node(node.id);
    const isMeta = (node.data as Record<string, unknown>)?.isMeta;
    const w = isMeta ? META_WIDTH : NODE_WIDTH;
    const h = isMeta ? META_HEIGHT : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  // Update edge handles based on layout positions
  const posMap = new Map(layouted.map((n) => [n.id, n.position]));
  const edgesWithHandles = edges.map((edge) => {
    const src = posMap.get(edge.source);
    const tgt = posMap.get(edge.target);
    if (!src || !tgt) return edge;
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2;
    return {
      ...edge,
      sourceHandle: horizontal ? (dx > 0 ? "right" : "bottom") : "bottom",
      targetHandle: horizontal ? (dx > 0 ? "left" : "top") : "top",
    };
  });

  return { nodes: layouted, edges: edgesWithHandles };
}
