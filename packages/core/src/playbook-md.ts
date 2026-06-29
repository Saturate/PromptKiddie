/**
 * Serialize/deserialize playbook graphs as Markdown.
 * Lets LLMs read, review, and edit playbooks as text.
 */
import type { PlaybookStep } from "./schema.js";

interface Phase {
  phase: string;
  title: string;
  steps: PlaybookStep[];
}

const NODE_ICONS: Record<string, string> = {
  sequence: "",
  parallel: "⫽ ",
  selector: "? ",
  block_ref: "▣ ",
  action: "",
};

const TYPE_TAG: Record<string, string> = {
  mechanical: "mechanical",
  judgment: "judgment",
};

export function playbookToMarkdown(name: string, phases: Phase[]): string {
  const lines: string[] = [`# ${name}`, ""];

  for (const phase of phases) {
    lines.push(`## ${phase.title}`, "");

    const stepMap = new Map(phase.steps.map((s) => [s.key, s]));
    const children = new Map<string, string[]>();
    const roots: string[] = [];

    for (const step of phase.steps) {
      const deps = step.dependsOn ?? [];
      if (deps.length === 0) {
        roots.push(step.key);
      }
      for (const dep of deps) {
        if (!children.has(dep)) children.set(dep, []);
        children.get(dep)!.push(step.key);
      }
    }

    const visited = new Set<string>();

    function renderStep(key: string, depth: number) {
      if (visited.has(key)) return;
      visited.add(key);

      const step = stepMap.get(key);
      if (!step) return;

      const indent = "  ".repeat(depth);
      const arrow = depth > 0 ? "→ " : "";
      const icon = NODE_ICONS[step.nodeType ?? "action"] ?? "";
      const typeTag = step.nodeType === "sequence" ? "" : ` [${TYPE_TAG[step.type] ?? step.type}]`;
      const cmd = step.command ? ` \`${step.command}\`` : "";
      const condition = step.condition ? ` (if: ${step.condition})` : "";
      const blockRef = step.blockRef ? ` → **${step.blockRef}** block` : "";
      const desc = step.description && !step.command ? ` — ${step.description.split("\n")[0].slice(0, 80)}` : "";

      lines.push(`${indent}${arrow}${icon}${step.title}${typeTag}${cmd}${condition}${blockRef}${desc}`);

      const kids = children.get(key) ?? [];
      for (const kid of kids) {
        renderStep(kid, depth + 1);
      }
    }

    for (const root of roots) {
      renderStep(root, 0);
    }

    // Catch any unvisited steps (disconnected nodes)
    for (const step of phase.steps) {
      if (!visited.has(step.key)) {
        renderStep(step.key, 0);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function blockToMarkdown(name: string, nodes: PlaybookStep[]): string {
  return playbookToMarkdown(name, [{ phase: "block", title: name, steps: nodes }]);
}
