"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
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

const nodeTypes = { step: StepNode, meta: MetaNode };

function stepsToFlow(steps: PlaybookStep[], phase?: string): { nodes: Node[]; edges: Edge[] } {
  const rawNodes: Node[] = [];
  const rawEdges: Edge[] = [];
  for (const step of steps) {
    const isMeta = step.nodeType === "sequence" || step.key.endsWith(".start") || step.key.endsWith(".end");
    const isBlock = step.nodeType === "block_ref" || !!step.blockRef;
    if (isMeta) {
      rawNodes.push({ id: step.key, type: "meta", position: { x: 0, y: 0 }, data: { label: step.title, phase: phase ?? "recon", variant: step.key.endsWith(".start") ? "start" : "end", isMeta: true } satisfies MetaNodeData });
    } else {
      rawNodes.push({ id: step.key, type: "step", position: { x: 0, y: 0 }, data: { title: step.title, stepKey: step.key, status: isBlock ? "pending" : "pending", nodeType: step.nodeType ?? (isBlock ? "block_ref" : "action"), type: step.type, priority: step.priority ?? 50, phase: phase ?? "recon" } satisfies StepNodeData });
    }
    for (const dep of step.dependsOn ?? []) {
      rawEdges.push({ id: `${dep}-${step.key}`, source: dep, target: step.key, style: { stroke: "#3a4260", strokeWidth: 1.5 }, type: "smoothstep" });
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
    const isMeta = step.nodeType === "sequence" || step.key.endsWith(".start") || step.key.endsWith(".end");
    const isBlock = step.nodeType === "block_ref" || !!step.blockRef;
    if (isMeta) {
      rawNodes.push({ id: step.key, type: "meta", position: { x: 0, y: 0 }, data: { label: step.title, phase: step.phase, variant: step.key.endsWith(".start") ? "start" : "end", isMeta: true } satisfies MetaNodeData });
    } else {
      rawNodes.push({ id: step.key, type: "step", position: { x: 0, y: 0 }, data: { title: step.title, stepKey: step.key, status: "pending", nodeType: isBlock ? "block_ref" : (step.nodeType ?? "action"), type: step.type, priority: step.priority ?? 50, phase: step.phase } satisfies StepNodeData });
    }
    for (const dep of step.dependsOn ?? []) {
      rawEdges.push({ id: `${dep}-${step.key}`, source: dep, target: step.key, style: { stroke: "#3a4260", strokeWidth: 1.5 }, type: "smoothstep" });
    }
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const endKey = sorted[i].steps.find((s) => s.key.endsWith(".end"))?.key;
    const startKey = sorted[i + 1].steps.find((s) => s.key.endsWith(".start"))?.key;
    if (endKey && startKey) {
      rawEdges.push({ id: `${endKey}-${startKey}`, source: endKey, target: startKey, style: { stroke: "#e8a040", strokeWidth: 2, strokeDasharray: "6 3" }, type: "smoothstep" });
    }
  }
  return layoutGraph(rawNodes, rawEdges, "TB");
}

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [blocks, setBlocks] = useState<BlockDef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Block drill-down
  const [editingBlock, setEditingBlock] = useState<BlockDef | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);

  const fetchPlaybooks = useCallback(async () => {
    const [pbRes, blRes] = await Promise.all([fetch("/api/playbooks"), fetch("/api/playbooks?blocks=1")]);
    if (pbRes.ok) setPlaybooks(await pbRes.json());
    if (blRes.ok) {
      const data = await blRes.json();
      if (Array.isArray(data)) setBlocks(data);
    }
  }, []);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  function selectPlaybook(pb: Playbook) {
    setSelected(pb.id);
    setEditing(JSON.parse(JSON.stringify(pb)));
    setEditingBlock(null);
    setBreadcrumb([]);
    const flow = playbookToFlow(pb);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNode(null);
  }

  function drillIntoBlock(blockName: string) {
    const block = blocks.find((b) => b.name === blockName);
    if (!block) { toast.error(`Block "${blockName}" not found`); return; }
    setEditingBlock(block);
    setBreadcrumb((prev) => [...prev, editing?.name ?? "Playbook"]);
    const flow = stepsToFlow(block.nodes as PlaybookStep[]);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNode(null);
  }

  function navigateBack() {
    if (editingBlock && editing) {
      setEditingBlock(null);
      setBreadcrumb([]);
      const flow = playbookToFlow(editing);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSelectedNode(null);
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
    if (editingBlock) {
      editingBlock.nodes = editingBlock.nodes.filter((s) => s.key !== key);
      for (const s of editingBlock.nodes) s.dependsOn = (s.dependsOn ?? []).filter((d) => d !== key);
      setEditingBlock({ ...editingBlock });
    } else if (editing) {
      for (const phase of editing.phases) {
        phase.steps = phase.steps.filter((s) => s.key !== key);
        for (const s of phase.steps) s.dependsOn = (s.dependsOn ?? []).filter((d) => d !== key);
      }
      setEditing({ ...editing });
    }
    setNodes((nds) => nds.filter((n) => n.id !== key));
    setEdges((eds) => eds.filter((e) => e.source !== key && e.target !== key));
    setSelectedNode(null);
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
                  {breadcrumb.map((b, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <button onClick={navigateBack} className="hover:text-foreground">{b}</button>
                      <ChevronRight className="size-3" />
                    </span>
                  ))}
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
                <span className="font-mono text-xs font-semibold text-foreground">Edit Node</span>
                <button onClick={() => deleteStep(currentStep.key)} className="p-1 hover:bg-destructive/10 rounded">
                  <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Title</label>
                <Input value={currentStep.title} onChange={(e) => updateStep(currentStep.key, "title", e.target.value)} className="font-mono text-xs h-7" />
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Key</label>
                <code className="block font-mono text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded">{currentStep.key}</code>
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Type</label>
                <div className="flex gap-1">
                  {(["mechanical", "judgment"] as const).map((t) => (
                    <button key={t} onClick={() => updateStep(currentStep.key, "type", t)}
                      className={`font-mono text-[10px] px-2 py-0.5 rounded border ${currentStep.type === t ? (t === "mechanical" ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-amber-400 border-amber-500/30 bg-amber-500/10") : "text-muted-foreground border-border"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Priority</label>
                <Input type="number" value={currentStep.priority ?? 50} onChange={(e) => updateStep(currentStep.key, "priority", parseInt(e.target.value))} className="font-mono text-xs h-7" />
              </div>
              {currentStep.type === "mechanical" && (
                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Command</label>
                  <Input value={currentStep.command ?? ""} onChange={(e) => updateStep(currentStep.key, "command", e.target.value)} placeholder="pk exec -- ..." className="font-mono text-[10px] h-7" />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Condition</label>
                <Input value={currentStep.condition ?? ""} onChange={(e) => updateStep(currentStep.key, "condition", e.target.value)} placeholder="ports.service contains http" className="font-mono text-[10px] h-7" />
              </div>
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Description</label>
                <textarea value={currentStep.description ?? ""} onChange={(e) => updateStep(currentStep.key, "description", e.target.value)} placeholder="What this step does..." className="w-full bg-muted rounded px-2 py-1 text-[10px] font-mono h-16 resize-none focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              {currentStep.blockRef && (
                <div className="pt-2 border-t border-border">
                  <button onClick={() => drillIntoBlock(currentStep.blockRef!)} className="text-xs font-mono text-primary hover:underline flex items-center gap-1">
                    Edit &quot;{currentStep.blockRef}&quot; block <ChevronRight className="size-3" />
                  </button>
                </div>
              )}
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
