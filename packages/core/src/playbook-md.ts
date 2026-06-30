/**
 * Lossless serialize/deserialize of playbook graphs as Markdown.
 *
 * Format (round-trippable):
 *
 *   # Playbook Name
 *
 *   ## Phase Title
 *   <!-- phase: recon -->
 *
 *   - `recon.tcp_scan` **TCP Port Scan** [action, mechanical, p:0]
 *     cmd: `rustscan -a $TARGET`
 *     after: (none)
 *
 *   - `recon.nmap_svc` **Nmap Service Scan** [action, mechanical, p:10]
 *     cmd: `nmap -sV -sC`
 *     if: ports.count > 0
 *     after: recon.tcp_scan
 *
 *   - `enum.web_recon` **Web Recon** [block_ref, mechanical, p:20, optional]
 *     block: web-recon
 *     after: recon.nmap_svc
 *     > Runs gobuster, nikto, and whatweb against discovered HTTP services
 *
 * Every field from PlaybookStep is preserved. The parser reconstructs
 * the exact same object array that the serializer consumed.
 */
import type { NodeType, PlaybookStep } from "./schema.js";

interface Phase {
  phase: string;
  title: string;
  steps: PlaybookStep[];
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

export function playbookToMarkdown(name: string, phases: Phase[]): string {
  const lines: string[] = [`# ${name}`, ""];

  for (const phase of phases) {
    lines.push(`## ${phase.title}`);
    lines.push(`<!-- phase: ${phase.phase} -->`, "");

    for (const step of phase.steps) {
      const tags: string[] = [
        step.nodeType ?? "action",
        step.type,
        `p:${step.priority ?? 50}`,
      ];
      if (step.optional) tags.push("optional");

      lines.push(`- \`${step.key}\` **${step.title}** [${tags.join(", ")}]`);

      if (step.command) lines.push(`  cmd: \`${step.command}\``);
      if (step.condition) lines.push(`  if: ${step.condition}`);
      if (step.blockRef) lines.push(`  block: ${step.blockRef}`);

      const deps = step.dependsOn ?? [];
      if (deps.length > 0) lines.push(`  after: ${deps.join(", ")}`);

      if (step.blockInputs && Object.keys(step.blockInputs).length > 0) {
        lines.push(`  inputs: ${JSON.stringify(step.blockInputs)}`);
      }
      if (step.inputSchema && Object.keys(step.inputSchema).length > 0) {
        lines.push(`  input-schema: ${JSON.stringify(step.inputSchema)}`);
      }
      if (step.outputSchema && Object.keys(step.outputSchema).length > 0) {
        lines.push(`  output-schema: ${JSON.stringify(step.outputSchema)}`);
      }

      if (step.description) {
        for (const descLine of step.description.split("\n")) {
          lines.push(`  > ${descLine}`);
        }
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

export function blockToMarkdown(name: string, nodes: PlaybookStep[]): string {
  return playbookToMarkdown(name, [{ phase: "block", title: name, steps: nodes }]);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const HEADING_RE = /^#\s+(.+)$/;
const PHASE_HEADING_RE = /^##\s+(.+)$/;
const PHASE_COMMENT_RE = /^<!--\s*phase:\s*(\S+)\s*-->$/;
const STEP_RE = /^-\s+`([^`]+)`\s+\*\*(.+?)\*\*\s+\[([^\]]+)\]$/;
const CMD_RE = /^\s{2}cmd:\s+`(.+)`$/;
const IF_RE = /^\s{2}if:\s+(.+)$/;
const BLOCK_RE = /^\s{2}block:\s+(.+)$/;
const AFTER_RE = /^\s{2}after:\s+(.+)$/;
const INPUTS_RE = /^\s{2}inputs:\s+(.+)$/;
const INPUT_SCHEMA_RE = /^\s{2}input-schema:\s+(.+)$/;
const OUTPUT_SCHEMA_RE = /^\s{2}output-schema:\s+(.+)$/;
const DESC_RE = /^\s{2}>\s?(.*)$/;

interface ParsedPlaybook {
  name: string;
  phases: Phase[];
}

export function markdownToPlaybook(md: string): ParsedPlaybook {
  const lines = md.split("\n");
  let name = "Untitled";
  const phases: Phase[] = [];
  let currentPhase: Phase | null = null;
  let currentStep: PlaybookStep | null = null;
  let descLines: string[] = [];

  function flushStep() {
    if (currentStep && currentPhase) {
      if (descLines.length > 0) {
        currentStep.description = descLines.join("\n");
        descLines = [];
      }
      currentPhase.steps.push(currentStep);
      currentStep = null;
    }
  }

  function flushPhase() {
    flushStep();
    if (currentPhase) phases.push(currentPhase);
    currentPhase = null;
  }

  for (const line of lines) {
    let m: RegExpMatchArray | null;

    m = line.match(HEADING_RE);
    if (m && !line.startsWith("##")) {
      name = m[1];
      continue;
    }

    m = line.match(PHASE_HEADING_RE);
    if (m) {
      flushPhase();
      currentPhase = { phase: "", title: m[1], steps: [] };
      continue;
    }

    m = line.match(PHASE_COMMENT_RE);
    if (m && currentPhase) {
      currentPhase.phase = m[1];
      continue;
    }

    m = line.match(STEP_RE);
    if (m) {
      flushStep();
      const key = m[1];
      const title = m[2];
      const tagStr = m[3];
      const tags = tagStr.split(",").map((t) => t.trim());

      let nodeType: NodeType = "action";
      let type: "mechanical" | "judgment" = "mechanical";
      let priority = 50;
      let optional = false;

      for (const tag of tags) {
        if (["action", "sequence", "selector", "parallel", "gate", "block_ref"].includes(tag)) {
          nodeType = tag as NodeType;
        } else if (tag === "mechanical" || tag === "judgment") {
          type = tag;
        } else if (tag.startsWith("p:")) {
          priority = parseInt(tag.slice(2), 10);
        } else if (tag === "optional") {
          optional = true;
        }
      }

      currentStep = { key, title, type, nodeType, priority };
      if (optional) currentStep.optional = true;
      continue;
    }

    if (!currentStep) continue;

    m = line.match(CMD_RE);
    if (m) { currentStep.command = m[1]; continue; }

    m = line.match(IF_RE);
    if (m) { currentStep.condition = m[1]; continue; }

    m = line.match(BLOCK_RE);
    if (m) { currentStep.blockRef = m[1]; continue; }

    m = line.match(AFTER_RE);
    if (m) {
      currentStep.dependsOn = m[1].split(",").map((d) => d.trim()).filter(Boolean);
      continue;
    }

    m = line.match(INPUTS_RE);
    if (m) {
      try { currentStep.blockInputs = JSON.parse(m[1]); } catch { /* skip malformed */ }
      continue;
    }

    m = line.match(INPUT_SCHEMA_RE);
    if (m) {
      try { currentStep.inputSchema = JSON.parse(m[1]); } catch { /* skip malformed */ }
      continue;
    }

    m = line.match(OUTPUT_SCHEMA_RE);
    if (m) {
      try { currentStep.outputSchema = JSON.parse(m[1]); } catch { /* skip malformed */ }
      continue;
    }

    m = line.match(DESC_RE);
    if (m) { descLines.push(m[1]); continue; }
  }

  flushPhase();
  return { name, phases };
}

export function markdownToBlock(md: string): { name: string; nodes: PlaybookStep[] } {
  const { name, phases } = markdownToPlaybook(md);
  return { name, nodes: phases.flatMap((p) => p.steps) };
}

// ---------------------------------------------------------------------------
// Mermaid export
// ---------------------------------------------------------------------------

const PHASE_COLORS: Record<string, string> = {
  recon: "#3b82f6",
  enum: "#8b5cf6",
  exploit: "#ef4444",
  postexploit: "#f97316",
  report: "#10b981",
};

const NODE_TYPE_SHAPES: Record<string, [string, string]> = {
  sequence: ["([", "])"],
  parallel: ["[[", "]]"],
  selector: ["{", "}"],
  gate: ["{{", "}}"],
  block_ref: [">", "]"],
  action: ["[", "]"],
};

function mermaidId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, "_");
}

function escapeLabel(s: string): string {
  return s.replace(/"/g, "#quot;");
}

export function playbookToMermaid(name: string, phases: Phase[]): string {
  const lines: string[] = [
    `%% ${name}`,
    "flowchart TD",
  ];

  for (const phase of phases) {
    const color = PHASE_COLORS[phase.phase] ?? "#6b7280";
    lines.push("");
    lines.push(`  subgraph ${mermaidId(phase.phase)}["${escapeLabel(phase.title)}"]`);
    lines.push(`    style ${mermaidId(phase.phase)} fill:${color}15,stroke:${color},stroke-width:2px`);

    for (const step of phase.steps) {
      const id = mermaidId(step.key);
      const [open, close] = NODE_TYPE_SHAPES[step.nodeType ?? "action"] ?? ["[", "]"];
      const typeIcon = step.type === "judgment" ? "🧠 " : "";
      const blockIcon = step.nodeType === "block_ref" ? "▣ " : "";
      const label = `${typeIcon}${blockIcon}${escapeLabel(step.title)}`;

      lines.push(`    ${id}${open}"${label}"${close}`);
    }

    lines.push("  end");
  }

  lines.push("");

  for (const phase of phases) {
    for (const step of phase.steps) {
      const deps = step.dependsOn ?? [];
      for (const dep of deps) {
        const fromId = mermaidId(dep);
        const toId = mermaidId(step.key);
        const label = step.condition ? ` -->|"${escapeLabel(step.condition)}"| ` : " --> ";
        lines.push(`  ${fromId}${label}${toId}`);
      }
    }
  }

  return lines.join("\n");
}

export function blockToMermaid(name: string, nodes: PlaybookStep[]): string {
  return playbookToMermaid(name, [{ phase: "block", title: name, steps: nodes }]);
}
