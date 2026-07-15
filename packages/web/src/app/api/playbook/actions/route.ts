import { CTF_ACTIONS, PENTEST_PLAYBOOK, buildActionGraph, actionGraphToMermaid } from "@promptkiddie/core";
import { NextRequest } from "next/server";

const PLAYBOOKS = {
  ctf: CTF_ACTIONS,
  pentest: PENTEST_PLAYBOOK,
} as const;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("playbook") ?? "ctf";
  const playbook = PLAYBOOKS[key as keyof typeof PLAYBOOKS] ?? CTF_ACTIONS;
  const graph = buildActionGraph(playbook.actions);
  const mermaid = actionGraphToMermaid(graph);

  const nodesWithState = graph.nodes.map((node) => ({
    ...node,
    running: 0,
    eventCount: 0,
  }));

  return Response.json({
    playbook: { name: playbook.name, key },
    available: Object.entries(PLAYBOOKS).map(([k, v]) => ({ key: k, name: v.name })),
    graph: { ...graph, nodes: nodesWithState },
    mermaid,
  });
}
