"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Save, GripVertical, Trash2, Package } from "lucide-react";
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
}

interface PlaybookPhase {
  phase: string;
  title: string;
  steps: PlaybookStep[];
}

interface Playbook {
  id: string;
  name: string;
  engagementType: string;
  description: string | null;
  isDefault: boolean;
  phases: PlaybookPhase[];
}

interface BlockDef {
  name: string;
  description: string;
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  nodes: PlaybookStep[];
}

const TYPE_COLORS: Record<string, string> = {
  ctf: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  blackbox: "bg-red-500/15 text-red-400 border-red-500/30",
  whitebox: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  bugbounty: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const PHASE_COLORS: Record<string, string> = {
  recon: "text-blue-400",
  enum: "text-purple-400",
  exploit: "text-red-400",
  postexploit: "text-orange-400",
  report: "text-emerald-400",
};

const PHASE_BG: Record<string, string> = {
  recon: "bg-blue-500",
  enum: "bg-purple-500",
  exploit: "bg-red-500",
  postexploit: "bg-orange-500",
  report: "bg-emerald-500",
};

const nodeTypes = { step: StepNode, meta: MetaNode };

function playbookToFlow(pb: Playbook): { nodes: Node[]; edges: Edge[] } {
  const rawNodes: Node[] = [];
  const rawEdges: Edge[] = [];
  const allSteps = pb.phases.flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.phase })));

  // Connect phase end -> next phase start
  const PHASE_ORDER = ["recon", "enum", "exploit", "postexploit", "report"];
  const sortedPhases = pb.phases.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));

  for (const step of allSteps) {
    const isMeta = step.nodeType === "sequence" || step.key.endsWith(".start") || step.key.endsWith(".end");

    if (isMeta) {
      rawNodes.push({
        id: step.key,
        type: "meta",
        position: { x: 0, y: 0 },
        data: {
          label: step.title,
          phase: step.phase,
          variant: step.key.endsWith(".start") ? "start" : "end",
          isMeta: true,
        } satisfies MetaNodeData,
      });
    } else {
      rawNodes.push({
        id: step.key,
        type: "step",
        position: { x: 0, y: 0 },
        data: {
          title: step.title,
          stepKey: step.key,
          status: "pending",
          nodeType: step.nodeType ?? "action",
          type: step.type,
          priority: step.priority ?? 50,
          phase: step.phase,
        } satisfies StepNodeData,
      });
    }

    for (const dep of step.dependsOn ?? []) {
      rawEdges.push({
        id: `${dep}-${step.key}`,
        source: dep,
        target: step.key,
        style: { stroke: "#3a4260", strokeWidth: 1.5 },
        type: "smoothstep",
      });
    }
  }

  // Connect phase transitions: phase.end -> next_phase.start
  for (let i = 0; i < sortedPhases.length - 1; i++) {
    const endKey = sortedPhases[i].steps.find((s) => s.key.endsWith(".end"))?.key;
    const startKey = sortedPhases[i + 1].steps.find((s) => s.key.endsWith(".start"))?.key;
    if (endKey && startKey) {
      rawEdges.push({
        id: `${endKey}-${startKey}`,
        source: endKey,
        target: startKey,
        style: { stroke: "#e8a040", strokeWidth: 2, strokeDasharray: "6 3" },
        type: "smoothstep",
      });
    }
  }

  return layoutGraph(rawNodes, rawEdges, "TB");
}

function EditPanel({
  selectedNode,
  playbook,
  onUpdate,
  onDelete,
}: {
  selectedNode: string | null;
  playbook: Playbook;
  onUpdate: (key: string, field: string, value: unknown) => void;
  onDelete: (key: string) => void;
}) {
  const step = playbook.phases.flatMap((p) => p.steps).find((s) => s.key === selectedNode);
  if (!step) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <p className="text-xs font-mono">Select a node to edit</p>
        <p className="text-[10px] text-primary/40 italic font-mono mt-1">or drag from the block library</p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-semibold text-foreground">Edit Node</span>
        <button onClick={() => onDelete(step.key)} className="p-1 hover:bg-destructive/10 rounded">
          <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Title</label>
        <Input value={step.title} onChange={(e) => onUpdate(step.key, "title", e.target.value)} className="font-mono text-xs h-7" />
      </div>
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Key</label>
        <Input value={step.key} disabled className="font-mono text-[10px] h-6 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Type</label>
        <div className="flex gap-1">
          {(["mechanical", "judgment"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onUpdate(step.key, "type", t)}
              className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                step.type === t
                  ? t === "mechanical" ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-amber-400 border-amber-500/30 bg-amber-500/10"
                  : "text-muted-foreground border-border"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Priority (0=highest)</label>
        <Input type="number" value={step.priority ?? 50} onChange={(e) => onUpdate(step.key, "priority", parseInt(e.target.value))} className="font-mono text-xs h-7" />
      </div>
      {step.type === "mechanical" && (
        <div className="space-y-1.5">
          <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Command</label>
          <Input value={step.command ?? ""} onChange={(e) => onUpdate(step.key, "command", e.target.value)} placeholder="pk exec -- ..." className="font-mono text-[10px] h-7" />
        </div>
      )}
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Condition</label>
        <Input value={step.condition ?? ""} onChange={(e) => onUpdate(step.key, "condition", e.target.value)} placeholder="ports.service contains http" className="font-mono text-[10px] h-7" />
      </div>
      <div className="space-y-1.5">
        <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Description</label>
        <textarea
          value={step.description ?? ""}
          onChange={(e) => onUpdate(step.key, "description", e.target.value)}
          placeholder="What this step does..."
          className="w-full bg-muted rounded px-2 py-1 text-[10px] font-mono h-16 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
    </div>
  );
}

const BUILTIN_BLOCKS: BlockDef[] = [
  { name: "HTTP Enumeration", description: "robots.txt, dir fuzz, source, tech fingerprint, vuln scan", inputSchema: { host: "string", port: "number" }, outputSchema: {}, nodes: [
    { key: "http.robots", title: "Check robots.txt", type: "mechanical", command: "pk exec -- curl -s http://{host}:{port}/robots.txt", priority: 10 },
    { key: "http.source", title: "View page source", type: "judgment", priority: 20 },
    { key: "http.tech", title: "Technology fingerprint", type: "mechanical", command: "pk exec -- whatweb http://{host}:{port}", priority: 15 },
    { key: "http.dir_fuzz", title: "Directory fuzzing", type: "mechanical", command: "pk exec -- ffuf -u http://{host}:{port}/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt", priority: 30, dependsOn: ["http.robots"] },
    { key: "http.vuln_scan", title: "Vulnerability scan", type: "mechanical", command: "pk exec -- nuclei -u http://{host}:{port} -tags cve,misconfig", priority: 40, dependsOn: ["http.tech"] },
  ]},
  { name: "SMB Enumeration", description: "enum4linux, shares, null session", inputSchema: { host: "string" }, outputSchema: {}, nodes: [
    { key: "smb.enum4linux", title: "enum4linux full scan", type: "mechanical", priority: 10 },
    { key: "smb.shares", title: "List SMB shares", type: "mechanical", priority: 20 },
    { key: "smb.null_session", title: "Test null session", type: "mechanical", priority: 30 },
  ]},
  { name: "SSH Attempt", description: "version check, default creds, captured creds", inputSchema: { host: "string" }, outputSchema: {}, nodes: [
    { key: "ssh.version", title: "Check SSH version", type: "judgment", priority: 10 },
    { key: "ssh.default_creds", title: "Try default credentials", type: "judgment", priority: 20 },
  ]},
  { name: "Linux Privesc", description: "SUID, sudo, cron, writable paths, kernel", inputSchema: { host: "string" }, outputSchema: {}, nodes: [
    { key: "privesc.suid", title: "Find SUID binaries", type: "mechanical", priority: 10 },
    { key: "privesc.sudo", title: "Check sudo -l", type: "mechanical", priority: 5 },
    { key: "privesc.cron", title: "Check cron jobs", type: "mechanical", priority: 20 },
    { key: "privesc.exploit", title: "Exploit privesc vector", type: "judgment", priority: 50, dependsOn: ["privesc.suid", "privesc.sudo", "privesc.cron"] },
  ]},
];

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const fetchPlaybooks = useCallback(async () => {
    const res = await fetch("/api/playbooks");
    if (res.ok) setPlaybooks(await res.json());
  }, []);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  function selectPlaybook(pb: Playbook) {
    setSelected(pb.id);
    const copy = JSON.parse(JSON.stringify(pb)) as Playbook;
    setEditing(copy);
    const flow = playbookToFlow(copy);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setSelectedNode(null);
  }

  function onConnect(connection: Connection) {
    if (!editing || !connection.source || !connection.target) return;
    setEdges((eds) => addEdge({ ...connection, type: "smoothstep", style: { stroke: "#232a3f", strokeWidth: 1.5 } }, eds));
    for (const phase of editing.phases) {
      const step = phase.steps.find((s) => s.key === connection.target);
      if (step) {
        step.dependsOn = [...(step.dependsOn ?? []), connection.source!].filter((v, i, a) => a.indexOf(v) === i);
      }
    }
  }

  function updateStep(key: string, field: string, value: unknown) {
    if (!editing) return;
    const updated = { ...editing };
    for (const phase of updated.phases) {
      const step = phase.steps.find((s) => s.key === key);
      if (step) {
        (step as Record<string, unknown>)[field] = value;
        break;
      }
    }
    setEditing(updated);
    setNodes((nds) => nds.map((n) => n.id === key ? { ...n, data: { ...n.data, [field]: value } } : n));
  }

  function deleteStep(key: string) {
    if (!editing) return;
    const updated = { ...editing };
    for (const phase of updated.phases) {
      phase.steps = phase.steps.filter((s) => s.key !== key);
      for (const step of phase.steps) {
        step.dependsOn = (step.dependsOn ?? []).filter((d) => d !== key);
      }
    }
    setEditing(updated);
    setNodes((nds) => nds.filter((n) => n.id !== key));
    setEdges((eds) => eds.filter((e) => e.source !== key && e.target !== key));
    setSelectedNode(null);
  }

  function addBlockToPhase(block: BlockDef, phase: string) {
    if (!editing) return;
    const updated = { ...editing };
    const p = updated.phases.find((ph) => ph.phase === phase);
    if (!p) return;
    const suffix = `_${Date.now().toString(36).slice(-4)}`;
    const keyMap = new Map<string, string>();
    for (const node of block.nodes) {
      keyMap.set(node.key, `${node.key}${suffix}`);
    }
    const newSteps: PlaybookStep[] = block.nodes.map((n) => ({
      ...n,
      key: keyMap.get(n.key)!,
      dependsOn: (n.dependsOn ?? []).map((d) => keyMap.get(d) ?? d),
    }));
    p.steps.push(...newSteps);
    setEditing(updated);
    const flow = playbookToFlow(updated);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    toast.success(`Added "${block.name}" to ${phase}`);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch(`/api/playbooks/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, description: editing.description, phases: editing.phases }),
    });
    setSaving(false);
    if (res.ok) { toast.success("Playbook saved"); fetchPlaybooks(); }
    else toast.error("Failed to save");
  }

  const totalSteps = (pb: Playbook) => pb.phases.reduce((sum, p) => sum + p.steps.length, 0);

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold font-mono">Playbooks</h1>
        <p className="text-sm text-muted-foreground font-mono">
          Graph-based procedures per engagement type. Drag blocks, connect dependencies, customize steps.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr_240px]">
        {/* Playbook list */}
        <div className="space-y-2">
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider px-1">Playbooks</p>
          {playbooks.map((pb) => (
            <button
              key={pb.id}
              onClick={() => selectPlaybook(pb)}
              className={`w-full text-left border rounded-lg p-2.5 font-mono transition-colors ${
                selected === pb.id ? "border-primary bg-primary/5" : "border-border hover:border-border/80 bg-card"
              }`}
            >
              <span className="text-xs font-semibold text-foreground block">{pb.name}</span>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge className={`font-mono text-[8px] border ${TYPE_COLORS[pb.engagementType] ?? ""}`}>
                  {pb.engagementType}
                </Badge>
                <span className="text-[9px] text-muted-foreground">{totalSteps(pb)} nodes</span>
              </div>
            </button>
          ))}

          {/* Block library */}
          <div className="mt-4">
            <button
              onClick={() => setShowBlocks(!showBlocks)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
            >
              <Package className="size-3 text-muted-foreground" />
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Block Library</span>
            </button>
            {showBlocks && (
              <div className="space-y-1 mt-1">
                {BUILTIN_BLOCKS.map((block) => (
                  <div key={block.name} className="border border-dashed border-border rounded p-2 space-y-1">
                    <span className="font-mono text-[10px] font-semibold text-foreground">{block.name}</span>
                    <p className="text-[9px] text-muted-foreground font-mono">{block.description}</p>
                    {editing && (
                      <div className="flex gap-1 flex-wrap">
                        {editing.phases.map((p) => (
                          <button
                            key={p.phase}
                            onClick={() => addBlockToPhase(block, p.phase)}
                            className={`text-[8px] font-mono px-1.5 py-0.5 rounded border border-border hover:border-primary/30 ${PHASE_COLORS[p.phase] ?? ""}`}
                          >
                            + {p.phase}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Graph editor */}
        <div className="min-h-[600px]">
          {editing ? (
            <div className="h-full flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="font-mono text-sm font-semibold h-8 flex-1"
                />
                <Button onClick={save} disabled={saving} size="sm" className="font-mono text-xs">
                  <Save className="size-3 mr-1" />
                  {saving ? "..." : "Save"}
                </Button>
              </div>
              <div className="flex-1 rounded-lg border border-border overflow-hidden bg-background">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodeClick={(_, node) => setSelectedNode(node.id)}
                  onPaneClick={() => setSelectedNode(null)}
                  onNodesDelete={(deleted) => deleted.forEach((n) => deleteStep(n.id))}
                  nodeTypes={nodeTypes}
                  deleteKeyCode="Backspace"
                  fitView
                  minZoom={0.2}
                  maxZoom={2}
                  proOptions={{ hideAttribution: true }}
                  defaultEdgeOptions={{ type: "smoothstep" }}
                  nodesDraggable
                >
                  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#232a3f" />
                  <Controls className="!bg-card !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground" />
                  <Panel position="top-left" className="!m-2">
                    <div className="flex gap-1">
                      {editing.phases.map((p) => (
                        <span key={p.phase} className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${PHASE_BG[p.phase] ?? "bg-muted"} text-white/80`}>
                          {p.phase} ({p.steps.length})
                        </span>
                      ))}
                    </div>
                  </Panel>
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

        {/* Node properties panel */}
        <div className="border border-border rounded-lg bg-card overflow-y-auto max-h-[700px]">
          <div className="px-3 py-2 border-b border-border">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Properties</span>
          </div>
          {editing && (
            <EditPanel
              selectedNode={selectedNode}
              playbook={editing}
              onUpdate={updateStep}
              onDelete={deleteStep}
            />
          )}
        </div>
      </div>
    </div>
  );
}
