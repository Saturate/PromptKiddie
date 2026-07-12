import { CTF_ACTIONS, buildActionGraph, actionGraphToMermaid } from "@promptkiddie/core";

export async function GET() {
  const playbook = CTF_ACTIONS;
  const graph = buildActionGraph(playbook.actions);
  const mermaid = actionGraphToMermaid(graph);

  // Static graph for now; engagementId-based state comes later.
  const nodesWithState = graph.nodes.map((node) => ({
    ...node,
    running: 0,
    eventCount: 0,
  }));

  return Response.json({
    graph: { ...graph, nodes: nodesWithState },
    mermaid,
  });
}
