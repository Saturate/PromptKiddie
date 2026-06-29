"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Save, Trash2, ChevronRight, ArrowLeft } from "lucide-react";
import { StepNode, type StepNodeData } from "@/components/graph/step-node";
import { MetaNode, type MetaNodeData } from "@/components/graph/meta-node";
import { ControlNode, type ControlNodeData } from "@/components/graph/control-node";
import { layoutGraph } from "@/components/graph/layout";

interface PlaybookStep {
  key: string;
  title: string;
  description?: string;
  type: "mechanical" | "judgment";
  nodeType?: string;
  command?: string;
  condition?: string;
  dependsOn?: string[];
  priority?: number;
  optional?: boolean;
  blockRef?: string;
}

interface PlaybookPhase { phase: string; title: string; steps: PlaybookStep[]; }
interface Playbook { id: string; name: string; engagementType: string; description: string | null; isDefault: boolean; phases: PlaybookPhase[]; }
interface BlockDef { id: string; name: string; description: string | null; nodes: PlaybookStep[]; }

const PHASE_BG: Record<string, string> = {
  recon: "bg-blue-500", enum: "bg-purple-500", exploit: "bg-red-500",
  postexploit: "bg-orange-500", report: "bg-emerald-500",
};

const nodeTypes = { step: StepNode, meta: MetaNode, control: ControlNode };

function resolveNodeType(step: PlaybookStep): string {
  if (step.nodeType === "parallel" || step.nodeType === "selector") return "control";
  if (step.nodeType === "sequence" || step.key.endsWith(".start") || step.key.endsWith(".end")) return "meta";
  return "step";
}

const EDGE_STYLE = { stroke: "#3a4260", strokeWidth: 1.5 };
const EDGE_DEFAULTS = { type: "smoothstep" as const, markerEnd: { type: "arrowclosed" as const, width: 12, height: 12, color: "#3a4260" } };

function stepsToFlow(steps: PlaybookStep[], phase?: string): { nodes: Node[]; edges: Edge[] } {
  const rawNodes: Node[] = [];
  const rawEdges: Edge[] = [];
  for (const step of steps) {
    const nodeType = resolveNodeType(step);
    const isBlock = step.nodeType === "block_ref" || !!step.blockRef;
    if (nodeType === "meta") {
      rawNodes.push({ id: step.key, type: "meta", position: { x: 0, y: 0 }, data: { label: step.title, phase: phase ?? "recon", variant: step.key.endsWith(".start") ? "start" : "end", isMeta: true } satisfies MetaNodeData });
    } else if (nodeType === "control") {
      rawNodes.push({ id: step.key, type: "control", position: { x: 0, y: 0 }, data: { label: step.title, variant: step.nodeType as "parallel" | "selector", phase: phase ?? "recon", isMeta: true } satisfies ControlNodeData });
    } else {
      rawNodes.push({ id: step.key, type: "step", position: { x: 0, y: 0 }, data: { title: step.title, stepKey: step.key, status: "pending", nodeType: isBlock ? "block_ref" : (step.nodeType ?? "action"), type: step.type, priority: step.priority ?? 50, phase: phase ?? "recon" } satisfies StepNodeData });
    }
    for (const dep of step.dependsOn ?? []) {
      rawEdges.push({ id: `${dep}-${step.key}`, source: dep, target: step.key, style: EDGE_STYLE, ...EDGE_DEFAULTS });
    }
  }
  return layoutGraph(rawNodes, rawEdges, "TB");
}

function playbookToFlow(pb: Playbook): { nodes: Node[]; edges: Edge[] } {
  const rawNodes: Node[] = [];
  const rawEdges: Edge[] = [];
  const allSteps = pb.phases.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.phase })));
  const PHASE_ORDER = ["recon", "enum", "exploit", "postexploit", "report"];
  const sorted = pb.phases.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));

  for (const step of allSteps) {
    const nodeType = resolveNodeType(step);
    const isBlock = step.nodeType === "block_ref" || !!step.blockRef;
    if (nodeType === "meta") {
      rawNodes.push({ id: step.key, type: "meta", position: { x: 0, y: 0 }, data: { label: step.title, phase: step.phase, variant: step.key.endsWith(".start") ? "start" : "end", isMeta: true } satisfies MetaNodeData });
    } else if (nodeType === "control") {
      rawNodes.push({ id: step.key, type: "control", position: { x: 0, y: 0 }, data: { label: step.title, variant: step.nodeType as "parallel" | "selector", phase: step.phase, isMeta: true } satisfies ControlNodeData });
    } else {
      rawNodes.push({ id: step.key, type: "step", position: { x: 0, y: 0 }, data: { title: step.title, stepKey: step.key, status: "pending", nodeType: isBlock ? "block_ref" : (step.nodeType ?? "action"), type: step.type, priority: step.priority ?? 50, phase: step.phase } satisfies StepNodeData });
    }
    for (const dep of step.dependsOn ?? []) {
      rawEdges.push({ id: `${dep}-${step.key}`, source: dep, target: step.key, style: EDGE_STYLE, ...EDGE_DEFAULTS });
    }
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const endKey = sorted[i].steps.find((s) => s.key.endsWith(".end"))?.key;
    const startKey = sorted[i + 1].steps.find((s) => s.key.endsWith(".start"))?.key;
    if (endKey && startKey) {
      rawEdges.push({ id: `${endKey}-${startKey}`, source: endKey, target: startKey, style: { stroke: "#e8a040", strokeWidth: 2, strokeDasharray: "6 3" }, ...EDGE_DEFAULTS, markerEnd: { type: "arrowclosed" as const, width: 14, height: 14, color: "#e8a040" } });
    }
  }
  return layoutGraph(rawNodes, rawEdges, "TB");
}

import { Suspense } from "react";

function PlaybooksInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [blocks, setBlocks] = useState<BlockDef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Block drill-down
  const [editingBlock, setEditingBlock] = useState<BlockDef | null>(null);

  const fetchPlaybooks = useCallback(async () => {
    setLoading(true);
    const [pbRes, blRes] = await Promise.all([fetch("/api/playbooks"), fetch("/api/playbooks?blocks=1")]);
    if (pbRes.ok) setPlaybooks(await pbRes.json());
    if (blRes.ok) {
      const data = await blRes.json();
      if (Array.isArray(data)) setBlocks(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  // URL sync: load from ?id= and ?block= params
  useEffect(() => {
    if (loading || !playbooks.length) return;
    const pbId = searchParams.get("id");
    const blockName = searchParams.get("block");
    if (blockName) {
      const block = blocks.find((b) => b.name === blockName);
      if (block && editingBlock?.id !== block.id) {
        drillIntoBlock(blockName);
      }
    } else if (pbId) {
      const pb = playbooks.find((p) => p.id === pbId);
      if (pb && selected !== pbId) selectPlaybook(pb);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, playbooks, blocks, searchParams]);

  function selectPlaybook(pb: Playbook) {
    setSelected(pb.id);
    setEditing(JSON.parse(JSON.stringify(pb)));
    setEditingBlock(null);
    const flow = playbookToFlow(pb);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNode(null);
    router.push(`/settings/playbooks?id=${pb.id}`, { scroll: false });
  }

  function drillIntoBlock(blockName: string) {
    const block = blocks.find((b) => b.name === blockName);
    if (!block) { toast.error(`Block "${blockName}" not found`); return; }
    setEditingBlock(block);
    const flow = stepsToFlow(block.nodes as PlaybookStep[]);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNode(null);
    router.push(`/settings/playbooks?block=${encodeURIComponent(blockName)}`, { scroll: false });
  }

  function navigateBack() {
    setEditingBlock(null);
    if (editing) {
      const flow = playbookToFlow(editing);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSelectedNode(null);
      router.push(`/settings/playbooks?id=${editing.id}`, { scroll: false });
    } else {
      setNodes([]);
      setEdges([]);
      setSelectedNode(null);
      router.push("/settings/playbooks", { scroll: false });
    }
  }

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    setEdges((eds) => addEdge({ ...connection, type: "smoothstep", style: { stroke: "#3a4260", strokeWidth: 1.5 } }, eds));
    if (editingBlock) {
      const step = editingBlock.nodes.find((s) => s.key === connection.target);
      if (step) step.dependsOn = [...(step.dependsOn ?? []), connection.source!].filter((v, i, a) => a.indexOf(v) === i);
    } else if (editing) {
      for (const phase of editing.phases) {
        const step = phase.steps.find((s) => s.key === connection.target);
        if (step) { step.dependsOn = [...(step.dependsOn ?? []), connection.source!].filter((v, i, a) => a.indexOf(v) === i); break; }
      }
    }
  }

  function handleNodeDoubleClick(_: React.MouseEvent, node: Node) {
    const data = node.data as StepNodeData;
    if (data.nodeType === "block_ref") {
      const step = editing?.phases.flatMap((p) => p.steps).find((s) => s.key === node.id);
      if (step?.blockRef) drillIntoBlock(step.blockRef);
    }
  }

  function updateStep(key: string, field: string, value: unknown) {
    if (editingBlock) {
      const step = editingBlock.nodes.find((s) => s.key === key);
      if (step) (step as Record<string, unknown>)[field] = value;
      setEditingBlock({ ...editingBlock });
    } else if (editing) {
      for (const phase of editing.phases) {
        const step = phase.steps.find((s) => s.key === key);
        if (step) { (step as Record<string, unknown>)[field] = value; break; }
      }
      setEditing({ ...editing });
    }
    setNodes((nds) => nds.map((n) => n.id === key ? { ...n, data: { ...n.data, [field]: value } } : n));
  }

  function deleteStep(key: string) {
    // Reconnect: find incoming and outgoing edges, bridge them
    const incoming = edges.filter((e) => e.target === key).map((e) => e.source);
    const outgoing = edges.filter((e) => e.source === key).map((e) => e.target);

    const getSteps = () => editingBlock?.nodes ?? editing?.phases.flatMap((p) => p.steps) ?? [];

    // Update data model: replace deps on children of deleted node with deleted node's parents
    if (editingBlock) {
      editingBlock.nodes = editingBlock.nodes.filter((s) => s.key !== key);
      for (const s of editingBlock.nodes) {
        if (s.dependsOn?.includes(key)) {
          s.dependsOn = [...s.dependsOn.filter((d) => d !== key), ...incoming].filter((v, i, a) => a.indexOf(v) === i);
        }
      }
      setEditingBlock({ ...editingBlock });
    } else if (editing) {
      for (const phase of editing.phases) {
        phase.steps = phase.steps.filter((s) => s.key !== key);
        for (const s of phase.steps) {
          if (s.dependsOn?.includes(key)) {
            s.dependsOn = [...s.dependsOn.filter((d) => d !== key), ...incoming].filter((v, i, a) => a.indexOf(v) === i);
          }
        }
      }
      setEditing({ ...editing });
    }

    // Update react-flow: remove node + old edges, add bridging edges
    setNodes((nds) => nds.filter((n) => n.id !== key));
    setEdges((eds) => {
      const filtered = eds.filter((e) => e.source !== key && e.target !== key);
      const bridges: Edge[] = [];
      for (const src of incoming) {
        for (const tgt of outgoing) {
          if (!filtered.some((e) => e.source === src && e.target === tgt)) {
            bridges.push({ id: `${src}-${tgt}`, source: src, target: tgt, style: EDGE_STYLE, ...EDGE_DEFAULTS });
          }
        }
      }
      return [...filtered, ...bridges];
    });
    setSelectedNode(null);
  }

  // Add node on edge drop: drag from handle into empty space
  function onConnectEnd(event: MouseEvent | TouchEvent, connectionState: { fromNode?: { id: string }; fromHandle?: { id: string; type: string } }) {
    if (!connectionState.fromNode || !connectionState.fromHandle) return;
    if (connectionState.fromHandle.type !== "source") return;

    const sourceId = connectionState.fromNode.id;
    const phase = (editingBlock?.nodes ?? editing?.phases.flatMap((p) => p.steps) ?? [])
      .find((s) => s.key === sourceId)?.key.split(".")[0] ?? "step";
    const newKey = `${phase}.new_${Date.now().toString(36).slice(-5)}`;

    const newStep: PlaybookStep = { key: newKey, title: "New step", type: "judgment", dependsOn: [sourceId], priority: 50 };

    if (editingBlock) {
      editingBlock.nodes.push(newStep);
      setEditingBlock({ ...editingBlock });
      const flow = stepsToFlow(editingBlock.nodes as PlaybookStep[]);
      setNodes(flow.nodes);
      setEdges(flow.edges);
    } else if (editing) {
      const targetPhase = editing.phases.find((p) => p.steps.some((s) => s.key === sourceId));
      if (targetPhase) {
        targetPhase.steps.push(newStep);
        setEditing({ ...editing });
        const flow = playbookToFlow(editing);
        setNodes(flow.nodes);
        setEdges(flow.edges);
      }
    }
    setSelectedNode(newKey);
    toast.success("Node added");
  }

  // Delete edge on reconnect drop to empty space
  function onReconnect(oldEdge: Edge, newConnection: Connection) {
    setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
    // Update data model
    if (newConnection.target && newConnection.source) {
      const getSteps = () => editingBlock?.nodes ?? editing?.phases.flatMap((p) => p.steps) ?? [];
      const oldTarget = getSteps().find((s) => s.key === oldEdge.target);
      if (oldTarget) {
        oldTarget.dependsOn = (oldTarget.dependsOn ?? []).filter((d) => d !== oldEdge.source);
      }
      const newTarget = getSteps().find((s) => s.key === newConnection.target);
      if (newTarget) {
        newTarget.dependsOn = [...(newTarget.dependsOn ?? []), newConnection.source!].filter((v, i, a) => a.indexOf(v) === i);
      }
    }
  }

  function onReconnectEnd(_: MouseEvent | TouchEvent, oldEdge: Edge, handleType: string) {
    // If reconnect ends on empty space, delete the edge
    const getSteps = () => editingBlock?.nodes ?? editing?.phases.flatMap((p) => p.steps) ?? [];
    const target = getSteps().find((s) => s.key === oldEdge.target);
    if (target) {
      target.dependsOn = (target.dependsOn ?? []).filter((d) => d !== oldEdge.source);
    }
    setEdges((eds) => eds.filter((e) => e.id !== oldEdge.id));
  }

  async function save() {
    setSaving(true);
    if (editingBlock) {
      await fetch(`/api/playbooks/${editingBlock.id}?type=block`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingBlock.name, nodes: editingBlock.nodes }),
      });
      toast.success(`Block "${editingBlock.name}" saved`);
    } else if (editing) {
      await fetch(`/api/playbooks/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editing.name, description: editing.description, phases: editing.phases }),
      });
      toast.success("Playbook saved");
    }
    setSaving(false);
    fetchPlaybooks();
  }

  // Edge visibility based on hover
  const visibleEdges = edges.map((e) => ({
    ...e,
    hidden: hoveredNode ? (e.source !== hoveredNode && e.target !== hoveredNode) : false,
    style: {
      ...e.style,
      opacity: hoveredNode ? (e.source === hoveredNode || e.target === hoveredNode ? 1 : 0.1) : 0.6,
    },
  }));

  const currentStep = (editingBlock ?? editing)
    ? (editingBlock?.nodes ?? editing?.phases.flatMap((p) => p.steps) ?? []).find((s) => s.key === selectedNode)
    : null;

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold font-mono">Playbooks</h1>
        <p className="text-sm text-muted-foreground font-mono">
          Double-click block nodes to edit sub-graphs. Connect nodes by dragging between handles.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr_220px]">
        {/* File tree */}
        <div className="font-mono text-xs">
          {loading && (
            <div className="flex items-center gap-2 px-2 py-4 text-muted-foreground">
              <span className="h-3 w-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              <span className="text-[10px]">Loading...</span>
            </div>
          )}
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">Playbooks</span>
            <button
              onClick={async () => {
                const name = prompt("Playbook name:");
                if (!name) return;
                const type = prompt("Type (ctf / blackbox / whitebox / bugbounty):", "ctf");
                if (!type) return;
                const res = await fetch("/api/playbooks", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name, engagementType: type, phases: [
                    { phase: "recon", title: "Reconnaissance", steps: [{ key: "recon.start", title: "Start Recon", type: "mechanical", nodeType: "sequence", priority: 0 }, { key: "recon.end", title: "Recon Complete", type: "mechanical", nodeType: "sequence", dependsOn: ["recon.start"], priority: 99 }] },
                  ] }),
                });
                if (res.ok) { toast.success("Created"); fetchPlaybooks(); }
              }}
              className="text-muted-foreground/40 hover:text-foreground transition-colors p-0.5"
              title="New playbook"
            >
              <svg viewBox="0 0 16 16" className="size-3"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
            </button>
          </div>
          {playbooks.map((pb) => (
            <button
              key={pb.id}
              onClick={() => selectPlaybook(pb)}
              className={`w-full text-left flex items-center gap-1.5 px-2 py-[5px] rounded transition-colors ${
                selected === pb.id && !editingBlock ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted-foreground/40"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>
              <span className="truncate">{pb.name}</span>
            </button>
          ))}

          {blocks.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-1.5 px-2 py-[5px] text-muted-foreground/50">
                <svg viewBox="0 0 16 16" className="size-3.5 shrink-0"><path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.62 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" fill="currentColor"/></svg>
                <span className="text-[10px]">Shared</span>
              </div>
              {blocks.map((b) => (
                <button
                  key={b.id}
                  onClick={() => drillIntoBlock(b.name)}
                  className={`w-full text-left flex items-center gap-1.5 pl-6 pr-2 py-[4px] rounded transition-colors ${
                    editingBlock?.id === b.id ? "bg-primary/10 text-primary" : "text-foreground/60 hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted-foreground/40"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M5 6h6M5 8h4M5 10h5" stroke="currentColor" strokeWidth="1"/></svg>
                  <span className="truncate text-[11px]">{b.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Graph canvas */}
        <div className="min-h-[650px]">
          {(editing || editingBlock) ? (
            <div className="h-full flex flex-col gap-2">
              {/* Breadcrumb + toolbar */}
              <div className="flex items-center gap-2">
                {editingBlock && (
                  <Button variant="ghost" size="sm" onClick={navigateBack} className="font-mono text-xs h-7 px-2">
                    <ArrowLeft className="size-3 mr-1" /> Back
                  </Button>
                )}
                <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                  {editingBlock && (
                    <>
                      <button onClick={navigateBack} className="hover:text-foreground">
                        {editing ? editing.name : "Shared"}
                      </button>
                      <ChevronRight className="size-3" />
                    </>
                  )}
                  <span className="text-foreground font-semibold">
                    {editingBlock?.name ?? editing?.name}
                  </span>
                </div>
                <span className="flex-1" />
                <Button onClick={save} disabled={saving} size="sm" className="font-mono text-xs h-7">
                  <Save className="size-3 mr-1" />{saving ? "..." : "Save"}
                </Button>
              </div>

              {/* Canvas */}
              <div className="flex-1 rounded-lg border border-border overflow-hidden bg-background">
                <ReactFlow
                  nodes={nodes}
                  edges={visibleEdges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onConnectEnd={(event, state) => onConnectEnd(event as MouseEvent, state as { fromNode?: { id: string }; fromHandle?: { id: string; type: string } })}
                  onReconnect={onReconnect}
                  onReconnectEnd={(event, oldEdge, handleType) => onReconnectEnd(event as MouseEvent, oldEdge, handleType)}
                  onNodeClick={(_, node) => setSelectedNode(node.id)}
                  onNodeDoubleClick={handleNodeDoubleClick}
                  onNodeMouseEnter={(_, node) => setHoveredNode(node.id)}
                  onNodeMouseLeave={() => setHoveredNode(null)}
                  onNodesDelete={(deleted) => deleted.forEach((n) => deleteStep(n.id))}
                  onPaneClick={() => setSelectedNode(null)}
                  nodeTypes={nodeTypes}
                  deleteKeyCode="Backspace"
                  fitView
                  minZoom={0.2}
                  maxZoom={2}
                  proOptions={{ hideAttribution: true }}
                  nodesDraggable
                  edgesReconnectable
                >
                  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#232a3f" />
                  <Controls className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground" />
                  {!editingBlock && editing && (
                    <Panel position="top-left" className="!m-2">
                      <div className="flex gap-1">
                        {editing.phases.map((p) => (
                          <span key={p.phase} className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${PHASE_BG[p.phase] ?? "bg-muted"} text-white/80`}>
                            {p.phase} ({p.steps.length})
                          </span>
                        ))}
                      </div>
                    </Panel>
                  )}
                </ReactFlow>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center border border-border rounded-lg bg-card">
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground font-mono">Select a playbook to edit</p>
                <p className="text-xs text-primary/40 italic font-mono">or just wing it, PK won&apos;t judge</p>
              </div>
            </div>
          )}
        </div>

        {/* Properties panel */}
        <div className="border border-border rounded-lg bg-card overflow-y-auto max-h-[700px]">
          <div className="px-3 py-2 border-b border-border">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Properties</span>
          </div>
          {currentStep ? (
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-foreground">
                  {currentStep.nodeType === "block_ref" ? "Block Reference" :
                   currentStep.nodeType === "sequence" ? "Phase Gate" :
                   currentStep.nodeType === "parallel" ? "Parallel Fork" :
                   currentStep.nodeType === "selector" ? "Selector" :
                   "Action Node"}
                </span>
                <button onClick={() => deleteStep(currentStep.key)} className="p-1 hover:bg-destructive/10 rounded">
                  <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>

              {/* Title - all node types */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Title</label>
                <Input value={currentStep.title} onChange={(e) => updateStep(currentStep.key, "title", e.target.value)} className="font-mono text-xs h-7" />
              </div>

              {/* Key - readonly */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Key</label>
                <code className="block font-mono text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded">{currentStep.key}</code>
              </div>

              {/* Node type selector */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Node Type</label>
                <div className="flex flex-wrap gap-1">
                  {(["action", "sequence", "parallel", "selector", "block_ref"] as const).map((nt) => (
                    <button key={nt} onClick={() => updateStep(currentStep.key, "nodeType", nt === "action" ? undefined : nt)}
                      className={`font-mono text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                        (currentStep.nodeType ?? "action") === nt
                          ? nt === "parallel" ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                          : nt === "selector" ? "text-purple-400 border-purple-500/30 bg-purple-500/10"
                          : nt === "sequence" ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
                          : nt === "block_ref" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                          : "text-foreground border-border bg-muted"
                          : "text-muted-foreground border-border hover:bg-muted/50"
                      }`}>
                      {nt === "block_ref" ? "block" : nt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action-specific fields */}
              {(!currentStep.nodeType || currentStep.nodeType === "action") && (
                <>
                  <div className="space-y-1.5">
                    <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Step Type</label>
                    <div className="flex gap-1">
                      {(["mechanical", "judgment"] as const).map((t) => (
                        <button key={t} onClick={() => updateStep(currentStep.key, "type", t)}
                          className={`font-mono text-[10px] px-2 py-0.5 rounded border ${currentStep.type === t ? (t === "mechanical" ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-amber-400 border-amber-500/30 bg-amber-500/10") : "text-muted-foreground border-border"}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  {currentStep.type === "mechanical" && (
                    <div className="space-y-1.5">
                      <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Command</label>
                      <Input value={currentStep.command ?? ""} onChange={(e) => updateStep(currentStep.key, "command", e.target.value)} placeholder="pk exec -- ..." className="font-mono text-[10px] h-7" />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Description</label>
                    <textarea value={currentStep.description ?? ""} onChange={(e) => updateStep(currentStep.key, "description", e.target.value)} placeholder="What this step does..." className="w-full bg-muted rounded px-2 py-1 text-[10px] font-mono h-16 resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                </>
              )}

              {/* Block ref fields */}
              {currentStep.nodeType === "block_ref" && (
                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Block</label>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[10px] text-primary bg-primary/10 px-2 py-1 rounded flex-1">{currentStep.blockRef ?? "none"}</code>
                    {currentStep.blockRef && (
                      <button onClick={() => drillIntoBlock(currentStep.blockRef!)} className="text-[10px] font-mono text-primary hover:underline flex items-center gap-0.5">
                        Edit <ChevronRight className="size-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Common: priority + condition */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Priority (0=highest)</label>
                <Input type="number" value={currentStep.priority ?? 50} onChange={(e) => updateStep(currentStep.key, "priority", parseInt(e.target.value))} className="font-mono text-xs h-7" />
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Condition</label>
                <Input value={currentStep.condition ?? ""} onChange={(e) => updateStep(currentStep.key, "condition", e.target.value)} placeholder="ports.service contains http" className="font-mono text-[10px] h-7" />
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-muted-foreground">
              <p className="text-xs font-mono">Select a node to edit</p>
              <p className="text-[10px] text-primary/40 italic font-mono mt-1">double-click blocks to drill in</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PlaybooksPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 font-mono text-xs text-muted-foreground"><span className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin mr-2" />Loading playbooks...</div>}>
      <PlaybooksInner />
    </Suspense>
  );
}
