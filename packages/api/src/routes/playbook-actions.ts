import { Hono } from "hono";
import {
  CTF_ACTIONS,
  PENTEST_PLAYBOOK,
  buildActionGraph,
  actionGraphToMermaid,
  simulateGraph,
  type Playbook,
} from "@promptkiddie/core";

const app = new Hono();

const PLAYBOOKS: Record<string, Playbook> = {
  ctf: CTF_ACTIONS,
  pentest: PENTEST_PLAYBOOK,
};

app.get("/playbooks/catalog", (c) => {
  const list = Object.entries(PLAYBOOKS).map(([key, pb]) => ({
    key,
    name: pb.name,
    description: pb.description,
    actionCount: pb.actions.length,
  }));
  return c.json(list);
});

app.get("/playbooks/catalog/:key", (c) => {
  const key = c.req.param("key");
  const pb = PLAYBOOKS[key];
  if (!pb) return c.json({ error: "playbook not found" }, 404);

  const graph = buildActionGraph(pb.actions);
  const mermaid = actionGraphToMermaid(graph);

  const triggeredByMap = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!triggeredByMap.has(edge.to)) triggeredByMap.set(edge.to, new Set());
    triggeredByMap.get(edge.to)!.add(edge.event);
  }

  const actions = pb.actions.map((a) => ({
    name: a.name,
    description: a.description,
    kind: a.run && a.prompt ? "both" : a.prompt ? "agent" : "script",
    emits: a.emits ?? [],
    triggeredBy: [...(triggeredByMap.get(a.name) ?? [])],
    hasRun: !!a.run,
    hasPrompt: !!a.prompt,
  }));

  return c.json({
    key,
    name: pb.name,
    description: pb.description,
    actions,
    graph,
    mermaid,
  });
});

app.post("/playbooks/catalog/:key/simulate", async (c) => {
  const key = c.req.param("key");
  const pb = PLAYBOOKS[key];
  if (!pb) return c.json({ error: "playbook not found" }, 404);

  const body = await c.req.json<{ events: Array<{ type: string; payload: Record<string, unknown> }> }>();
  if (!body.events || !Array.isArray(body.events)) {
    return c.json({ error: "body must include an events array" }, 400);
  }

  const steps = simulateGraph(pb.actions, body.events);
  return c.json({ steps });
});

export default app;
