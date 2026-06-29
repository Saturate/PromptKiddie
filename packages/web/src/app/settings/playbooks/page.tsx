"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus, Trash2, GripVertical } from "lucide-react";

interface PlaybookStep {
  key: string;
  title: string;
  description?: string;
  type: "mechanical" | "judgment";
  command?: string;
  condition?: string;
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

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const fetchPlaybooks = useCallback(async () => {
    const res = await fetch("/api/playbooks");
    if (res.ok) setPlaybooks(await res.json());
  }, []);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  function selectPlaybook(pb: Playbook) {
    setSelected(pb.id);
    setEditing(JSON.parse(JSON.stringify(pb)));
    setExpandedPhases(new Set(pb.phases.map((p) => p.phase)));
  }

  function togglePhase(phase: string) {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      return next;
    });
  }

  function updateStep(phaseIdx: number, stepIdx: number, field: string, value: unknown) {
    if (!editing) return;
    const updated = { ...editing };
    const phases = [...updated.phases];
    const steps = [...phases[phaseIdx].steps];
    steps[stepIdx] = { ...steps[stepIdx], [field]: value };
    phases[phaseIdx] = { ...phases[phaseIdx], steps };
    updated.phases = phases;
    setEditing(updated);
  }

  function removeStep(phaseIdx: number, stepIdx: number) {
    if (!editing) return;
    const updated = { ...editing };
    const phases = [...updated.phases];
    const steps = [...phases[phaseIdx].steps];
    steps.splice(stepIdx, 1);
    phases[phaseIdx] = { ...phases[phaseIdx], steps };
    updated.phases = phases;
    setEditing(updated);
  }

  function addStep(phaseIdx: number) {
    if (!editing) return;
    const updated = { ...editing };
    const phases = [...updated.phases];
    const phase = phases[phaseIdx];
    const key = `${phase.phase}.new_step_${phase.steps.length + 1}`;
    const steps = [...phase.steps, { key, title: "New step", type: "judgment" as const }];
    phases[phaseIdx] = { ...phase, steps };
    updated.phases = phases;
    setEditing(updated);
  }

  function addPhase() {
    if (!editing) return;
    const updated = { ...editing };
    const phaseName = `custom_${updated.phases.length + 1}`;
    updated.phases = [...updated.phases, { phase: phaseName, title: "New Phase", steps: [] }];
    setEditing(updated);
    setExpandedPhases((prev) => new Set([...prev, phaseName]));
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch(`/api/playbooks/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        description: editing.description,
        phases: editing.phases,
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success("Playbook saved");
      fetchPlaybooks();
    } else {
      toast.error("Failed to save");
    }
  }

  const totalSteps = (pb: Playbook) => pb.phases.reduce((sum, p) => sum + p.steps.length, 0);

  return (
    <div className="flex flex-col gap-4 py-4 px-4 md:gap-6 md:py-6 lg:px-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold font-mono">Playbooks</h1>
        <p className="text-sm text-muted-foreground font-mono">
          Step-by-step procedures per engagement type. Customize or create your own.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* Playbook list */}
        <div className="space-y-2">
          {playbooks.map((pb) => (
            <button
              key={pb.id}
              onClick={() => selectPlaybook(pb)}
              className={`w-full text-left border rounded-lg p-3 font-mono transition-colors ${
                selected === pb.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border/80 bg-card"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-foreground">{pb.name}</span>
                {pb.isDefault && (
                  <Badge className="font-mono text-[9px] bg-primary/10 text-primary border-primary/30 border">
                    default
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge className={`font-mono text-[9px] border ${TYPE_COLORS[pb.engagementType] ?? ""}`}>
                  {pb.engagementType}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {pb.phases.length} phases, {totalSteps(pb)} steps
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Editor */}
        {editing ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1 mr-4">
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="font-mono text-sm font-semibold h-8"
                  />
                  <Input
                    value={editing.description ?? ""}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="Description..."
                    className="font-mono text-xs h-7 text-muted-foreground"
                  />
                </div>
                <Button onClick={save} disabled={saving} size="sm" className="font-mono text-xs shrink-0">
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {editing.phases.map((phase, pi) => (
                  <div key={phase.phase} className="border border-border rounded-lg overflow-hidden">
                    {/* Phase header */}
                    <button
                      onClick={() => togglePhase(phase.phase)}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      {expandedPhases.has(phase.phase) ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                      <span className={`font-mono text-xs font-semibold uppercase tracking-wider ${PHASE_COLORS[phase.phase] ?? "text-foreground"}`}>
                        {phase.title || phase.phase}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                        {phase.steps.length} steps
                      </span>
                    </button>

                    {/* Steps */}
                    {expandedPhases.has(phase.phase) && (
                      <div className="px-3 py-2 space-y-2">
                        {phase.steps.map((step, si) => (
                          <div key={step.key} className="border border-border rounded px-3 py-2 space-y-1.5 bg-background">
                            <div className="flex items-center gap-2">
                              <GripVertical className="size-3 text-muted-foreground/30 shrink-0" />
                              <Input
                                value={step.title}
                                onChange={(e) => updateStep(pi, si, "title", e.target.value)}
                                className="font-mono text-xs h-6 flex-1"
                              />
                              <button
                                onClick={() => updateStep(pi, si, "type", step.type === "mechanical" ? "judgment" : "mechanical")}
                                className={`font-mono text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${
                                  step.type === "mechanical"
                                    ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
                                    : "text-amber-400 border-amber-500/30 bg-amber-500/10"
                                }`}
                              >
                                {step.type}
                              </button>
                              <button
                                onClick={() => removeStep(pi, si)}
                                className="p-0.5 hover:bg-destructive/10 rounded"
                              >
                                <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                              </button>
                            </div>
                            {step.type === "mechanical" && (
                              <Input
                                value={step.command ?? ""}
                                onChange={(e) => updateStep(pi, si, "command", e.target.value)}
                                placeholder="pk exec -- ..."
                                className="font-mono text-[10px] h-6 text-muted-foreground"
                              />
                            )}
                            <Input
                              value={step.description ?? ""}
                              onChange={(e) => updateStep(pi, si, "description", e.target.value)}
                              placeholder="Description (optional)..."
                              className="font-mono text-[10px] h-6 text-muted-foreground"
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => addStep(pi)}
                          className="w-full flex items-center justify-center gap-1 py-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground border border-dashed border-border rounded hover:border-border/80 transition-colors"
                        >
                          <Plus className="size-3" /> Add step
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <button
                  onClick={addPhase}
                  className="w-full flex items-center justify-center gap-1 py-2 text-xs font-mono text-muted-foreground hover:text-foreground border border-dashed border-border rounded-lg hover:border-border/80 transition-colors"
                >
                  <Plus className="size-3.5" /> Add phase
                </button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-12 pb-12">
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground font-mono">Select a playbook to edit</p>
                <p className="text-xs text-primary/40 italic font-mono">or just wing it, PK won&apos;t judge</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
