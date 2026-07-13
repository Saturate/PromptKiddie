#!/usr/bin/env node
/**
 * `pk`: the PromptKiddie engagement CLI. The orchestrator and sub-agents use this to read
 * and write the engagement database. Thin wrapper over @promptkiddie/core.
 */
import "dotenv/config";
import { Command } from "commander";
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  addEvidence,
  closeDb,
  createPlaybook,
  generateReport,
  getEngagement,
  getPlaybook,
  getRepo,
  listPlaybooks,
  loadConfig,
  markdownToPlaybook,
  playbookToMarkdown,
  playbookToMermaid,
  updatePlaybook,
} from "@promptkiddie/core";
import { execFileSync, type StdioOptions } from "node:child_process";
import { resolveEngagementId, setActiveEngagement } from "./state.js";

const config = loadConfig();
const repo = getRepo();

const program = new Command();
program
  .name("pk")
  .description("PromptKiddie engagement CLI: log and query the engagement database")
  .version("0.1.0");

const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

// --- engagement ------------------------------------------------------------
const engagement = program.command("engagement").description("Manage engagements");

engagement
  .command("new")
  .requiredOption("--name <name>")
  .requiredOption("--type <type>", "ctf | whitebox | blackbox | bugbounty")
  .option("--scope <scope>", "free-form scope summary")
  .option("--brief <brief>", "engagement brief / description")
  .option("--source-url <url>", "source URL (e.g. THM room, HTB machine)")
  .option("--group <group>", "engagement group (e.g. THM, HTB)")
  .option("--no-playbook", "skip playbook step initialization")
  .action(async (o) => {
    const row = await repo.createEngagement({ name: o.name, type: o.type, scope: o.scope, brief: o.brief, sourceUrl: o.sourceUrl, group: o.group }) as { id: string };
    await setActiveEngagement(row.id);

    let stepCount = 0;
    if (o.playbook !== false) {
      const pb = await repo.getDefaultPlaybook(o.type);
      if (pb) {
        const steps = await repo.initEngagementSteps(row.id, (pb as { id: string }).id);
        stepCount = (steps as unknown[]).length;
      }
    }

    console.error(`Created engagement ${row.id} (${stepCount} playbook steps initialized)`);
    out(row);
  });

engagement
  .command("list")
  .action(async () => out(await repo.listEngagements()));

engagement
  .command("use")
  .argument("<id>")
  .action(async (id: string) => {
    const row = await getEngagement(id);
    if (!row) throw new Error(`No engagement with id ${id}`);
    await setActiveEngagement(id);
    console.error(`Active engagement: ${row.name} (${id})`);
  });

engagement
  .command("show")
  .argument("[id]")
  .action(async (id?: string) => {
    const eid = await resolveEngagementId(id);
    const eng = await repo.getEngagement(eid);
    if (!eng) throw new Error(`No engagement with id ${eid}`);
    const activity = await repo.listActivity(eid);
    out({
      engagement: eng,
      targets: await repo.listTargets(eid),
      findings: await repo.listFindings(eid),
      objectives: await repo.listObjectives(eid),
      evidence: await repo.listEvidence(eid),
      artifacts: await repo.listArtifacts(eid),
      agentRuns: await repo.listAgentRuns(eid),
      activity: activity.slice(0, 50),
    });
  });

engagement
  .command("status")
  .argument("<status>", "scoping | active | paused | reporting | done")
  .option("--engagement <id>")
  .action(async (status, o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.setEngagementStatus(eid, status));
  });

engagement
  .command("delete")
  .argument("<id>")
  .action(async (id: string) => {
    const row = await repo.deleteEngagement(id);
    if (!row) throw new Error(`No engagement with id ${id}`);
    console.error(`Deleted engagement: ${(row as { name: string }).name} (${id})`);
    out(row);
  });

engagement
  .command("update")
  .argument("<id>")
  .option("--name <name>")
  .option("--brief <brief>")
  .option("--source-url <url>")
  .option("--group <group>")
  .option("--scope <scope>")
  .action(async (id: string, o) => {
    const updates: Record<string, unknown> = {};
    if (o.name !== undefined) updates.name = o.name;
    if (o.brief !== undefined) updates.brief = o.brief;
    if (o.sourceUrl !== undefined) updates.sourceUrl = o.sourceUrl;
    if (o.group !== undefined) updates.group = o.group;
    if (o.scope !== undefined) updates.scope = o.scope;
    out(await repo.updateEngagement(id, updates));
  });

engagement
  .command("phase")
  .argument("[target-phase]", "scoping | recon | enum | exploit | postexploit | report")
  .option("--engagement <id>")
  .action(async (targetPhase: string | undefined, o) => {
    const eid = await resolveEngagementId(o.engagement);
    if (!targetPhase) {
      out(await repo.getPhase(eid));
      return;
    }
    const result = await repo.advancePhase(eid, targetPhase) as { warning?: string; engagement?: { phase: string } };
    if (result.warning) console.error(`Warning: ${result.warning}`);
    out({ phase: result.engagement?.phase, warning: result.warning });
  });

// --- target ----------------------------------------------------------------
const target = program.command("target").description("Manage targets");

target
  .command("add")
  .requiredOption("--kind <kind>", "host | domain | url | app | repo")
  .requiredOption("--id <identifier>", "the target identifier")
  .option("--in-scope", "mark as in scope (only if the RoE covers it)", false)
  .option("--notes <notes>")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(
      await repo.addTarget({
        engagementId: eid,
        kind: o.kind,
        identifier: o.id,
        inScope: o.inScope,
        notes: o.notes,
      }),
    );
  });

target
  .command("list")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listTargets(await resolveEngagementId(o.engagement))));

target
  .command("update")
  .argument("<id>")
  .option("--in-scope", "mark as in scope")
  .option("--no-in-scope", "mark as out of scope")
  .option("--notes <notes>")
  .option("--kind <kind>", "host | domain | url | app | repo")
  .option("--identifier <identifier>")
  .action(async (id: string, o) => {
    const updates: Record<string, unknown> = {};
    if (o.inScope !== undefined) updates.inScope = o.inScope;
    if (o.notes !== undefined) updates.notes = o.notes;
    if (o.kind !== undefined) updates.kind = o.kind;
    if (o.identifier !== undefined) updates.identifier = o.identifier;
    out(await repo.updateTarget(id, updates));
  });

// --- port ------------------------------------------------------------------
const port = program.command("port").description("Manage ports on targets");

port
  .command("add")
  .requiredOption("--target <id>", "target UUID")
  .requiredOption("--port <number>", "port number", parseInt)
  .option("--protocol <proto>", "tcp | udp", "tcp")
  .option("--state <state>", "open | closed | filtered", "open")
  .option("--service <name>", "service name, e.g. http, ssh")
  .option("--version <version>", "version string")
  .option("--banner <text>", "raw banner")
  .option("--notes <text>")
  .action(async (o) => {
    out(
      await repo.addPort({
        targetId: o.target,
        port: o.port,
        protocol: o.protocol,
        state: o.state,
        service: o.service,
        version: o.version,
        banner: o.banner,
        notes: o.notes,
      }),
    );
  });

port
  .command("list")
  .requiredOption("--target <id>", "target UUID")
  .action(async (o) => out(await repo.listPorts(o.target)));

// --- finding ---------------------------------------------------------------
const finding = program.command("finding").description("Manage findings");

finding
  .command("add")
  .requiredOption("--title <title>")
  .option("--severity <severity>", "critical | high | medium | low | info", "info")
  .option("--cvss <score>", "CVSS v3.1 base score", parseFloat)
  .option("--cvss-vector <vector>", "CVSS 3.1 vector string")
  .option("--cwe <id>", "CWE identifier, e.g. CWE-89")
  .option("--status <status>", "triage | confirmed | reported | remediated", "triage")
  .option("--owasp <refs>", "comma-separated OWASP refs, e.g. A03:2021")
  .option("--attack <ids>", "comma-separated ATT&CK ids, e.g. T1190")
  .option("--cve <ids>", "comma-separated CVE ids")
  .option("--target <id>", "affected target id")
  .option("--desc <description>")
  .option("--exploit-scenario <text>", "concrete exploit: input and impact")
  .option("--source-ref <ref>", "where untrusted input enters")
  .option("--sink-ref <ref>", "where input is used unsafely")
  .option("--confidence <score>", "0.0-1.0 confidence", parseFloat)
  .option("--remediation <text>")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(
      await repo.addFinding({
        engagementId: eid,
        title: o.title,
        severity: o.severity,
        cvss: o.cvss,
        cvssVector: o.cvssVector,
        cwe: o.cwe,
        status: o.status,
        owasp: list(o.owasp),
        attackTechniques: list(o.attack),
        cve: list(o.cve),
        targetId: o.target,
        description: o.desc,
        exploitScenario: o.exploitScenario,
        sourceRef: o.sourceRef,
        sinkRef: o.sinkRef,
        confidence: o.confidence,
        remediation: o.remediation,
      }),
    );
  });

finding
  .command("list")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listFindings(await resolveEngagementId(o.engagement))));

finding
  .command("update")
  .argument("<id>")
  .option("--title <title>")
  .option("--severity <severity>", "critical | high | medium | low | info")
  .option("--cvss <score>", "CVSS v3.1 base score", parseFloat)
  .option("--cvss-vector <vector>", "CVSS 3.1 vector string")
  .option("--cwe <id>", "CWE identifier")
  .option("--status <status>", "triage | confirmed | reported | remediated")
  .option("--owasp <refs>", "comma-separated OWASP refs")
  .option("--attack <ids>", "comma-separated ATT&CK ids")
  .option("--cve <ids>", "comma-separated CVE ids")
  .option("--target <id>", "affected target id")
  .option("--desc <description>")
  .option("--exploit-scenario <text>")
  .option("--source-ref <ref>")
  .option("--sink-ref <ref>")
  .option("--confidence <score>", "0.0-1.0", parseFloat)
  .option("--remediation <text>")
  .option("--verdict <verdict>", "true_positive | false_positive | unverified")
  .option("--verdict-confidence <score>", "0-10 confidence in verdict", parseInt)
  .option("--verdict-reason <text>")
  .action(async (id: string, o) => {
    const updates: Record<string, unknown> = {};
    if (o.title !== undefined) updates.title = o.title;
    if (o.severity !== undefined) updates.severity = o.severity;
    if (o.cvss !== undefined) updates.cvss = o.cvss;
    if (o.cvssVector !== undefined) updates.cvssVector = o.cvssVector;
    if (o.cwe !== undefined) updates.cwe = o.cwe;
    if (o.status !== undefined) updates.status = o.status;
    if (o.owasp !== undefined) updates.owasp = list(o.owasp);
    if (o.attack !== undefined) updates.attackTechniques = list(o.attack);
    if (o.cve !== undefined) updates.cve = list(o.cve);
    if (o.target !== undefined) updates.targetId = o.target;
    if (o.desc !== undefined) updates.description = o.desc;
    if (o.exploitScenario !== undefined) updates.exploitScenario = o.exploitScenario;
    if (o.sourceRef !== undefined) updates.sourceRef = o.sourceRef;
    if (o.sinkRef !== undefined) updates.sinkRef = o.sinkRef;
    if (o.confidence !== undefined) updates.confidence = o.confidence;
    if (o.remediation !== undefined) updates.remediation = o.remediation;
    if (o.verdict !== undefined) updates.verdict = o.verdict;
    if (o.verdictConfidence !== undefined) updates.verdictConfidence = o.verdictConfidence;
    if (o.verdictReason !== undefined) updates.verdictReason = o.verdictReason;
    out(await repo.updateFinding(id, updates));
  });

// --- evidence --------------------------------------------------------------
const ev = program.command("evidence").description("Manage evidence artifacts");

ev.command("add")
  .requiredOption("--path <path>", "path under engagements/<slug>/")
  .requiredOption("--type <type>", "flag | screenshot | scan | output | file")
  .option("--finding <id>", "link to a finding")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await addEvidence({ engagementId: eid, path: o.path, type: o.type, findingId: o.finding }));
  });

ev.command("list")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listEvidence(await resolveEngagementId(o.engagement))));

// --- objective -------------------------------------------------------------
const objective = program.command("objective").description("Manage CTF objectives / tasks");

objective
  .command("add")
  .requiredOption("--task-number <n>", "task number", parseInt)
  .requiredOption("--title <title>")
  .option("--description <desc>")
  .option("--flag-format <format>", "expected flag format, e.g. THM{...}")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.addObjective({ engagementId: eid, taskNumber: o.taskNumber, title: o.title, description: o.description, flagFormat: o.flagFormat }));
  });

objective
  .command("list")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listObjectives(await resolveEngagementId(o.engagement))));

objective
  .command("capture")
  .argument("<id>", "objective id")
  .requiredOption("--flag <flag>", "captured flag value")
  .action(async (id: string, o) => out(await repo.captureFlag(id, o.flag)));

// --- artifact --------------------------------------------------------------
const artifact = program.command("artifact").description("Manage artifacts (loot, creds, docs)");

artifact
  .command("add")
  .requiredOption("--title <title>")
  .requiredOption("--type <type>", "credential | loot | document | config | other")
  .option("--content <content>", "inline content")
  .option("--path <path>", "path to artifact file")
  .option("--finding <id>", "link to a finding")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.addArtifact({ engagementId: eid, title: o.title, type: o.type, content: o.content, path: o.path, findingId: o.finding }));
  });

artifact
  .command("list")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listArtifacts(await resolveEngagementId(o.engagement))));

// --- playbook (export/import as markdown) ----------------------------------
const playbook = program.command("playbook").description("Manage playbook templates");

playbook
  .command("list")
  .description("List all playbook templates")
  .action(async () => {
    const pbs = await listPlaybooks();
    for (const pb of pbs) {
      const phaseCount = (pb.phases as unknown[]).length;
      const def = pb.isDefault ? " (default)" : "";
      console.log(`${pb.id}  ${pb.name}  [${pb.engagementType}]  ${phaseCount} phases${def}`);
    }
  });

playbook
  .command("export")
  .description("Export a playbook to markdown or mermaid")
  .argument("<id>", "Playbook UUID or engagement type (ctf, blackbox, ...)")
  .option("-o, --out <file>", "Write to file instead of stdout")
  .option("-f, --format <format>", "Output format: md or mermaid", "md")
  .action(async (idOrType, o) => {
    const isUuid = /^[0-9a-f]{8}-/.test(idOrType);
    let pb = isUuid ? await getPlaybook(idOrType) : null;
    if (!pb) {
      const { getDefaultPlaybook } = await import("@promptkiddie/core");
      pb = await getDefaultPlaybook(idOrType);
    }
    if (!pb) { console.error(`No playbook found for "${idOrType}"`); process.exit(1); }
    const phases = pb.phases as Parameters<typeof playbookToMarkdown>[1];
    const output = o.format === "mermaid"
      ? playbookToMermaid(pb.name, phases)
      : playbookToMarkdown(pb.name, phases);
    if (o.out) {
      await writeFile(o.out, output, "utf-8");
      console.error(`Wrote ${o.out}`);
    } else {
      console.log(output);
    }
  });

playbook
  .command("import")
  .description("Import a playbook from a markdown file")
  .argument("<file>", "Path to markdown file")
  .option("--type <type>", "Engagement type (ctf, blackbox, whitebox, bugbounty)", "ctf")
  .option("--update <id>", "Update existing playbook instead of creating new")
  .action(async (file, o) => {
    const md = await readFile(file, "utf-8");
    const parsed = markdownToPlaybook(md);
    if (o.update) {
      const row = await updatePlaybook(o.update, { name: parsed.name, phases: parsed.phases });
      console.log(`Updated playbook ${row.id}: ${row.name}`);
    } else {
      const row = await createPlaybook({
        name: parsed.name,
        engagementType: o.type,
        phases: parsed.phases,
      });
      console.log(`Created playbook ${row.id}: ${row.name}`);
    }
  });

// --- step (playbook graph execution) ---------------------------------------
const step = program.command("step").description("Playbook step execution");

step
  .command("list")
  .description("List all playbook steps with status")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listEngagementSteps(await resolveEngagementId(o.engagement))));

step
  .command("next")
  .description("Get next ready steps from the playbook graph")
  .option("--max <n>", "Max steps to return", "5")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.getNextSteps(eid, parseInt(o.max, 10)));
  });

step
  .command("start")
  .description("Mark a step as running (glows amber in the UI)")
  .argument("<key>", "Step key, e.g. recon.tcp_scan")
  .option("--agent <agentId>", "ID of the agent executing this step")
  .option("--engagement <id>")
  .action(async (key, o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.startStep(eid, key, o.agent));
  });

step
  .command("complete")
  .description("Mark a step as done")
  .argument("<key>", "Step key, e.g. recon.tcp_scan")
  .option("--result-type <type>", "What was produced: port, finding, evidence, activity")
  .option("--result-id <id>", "UUID of the result row")
  .option("--engagement <id>")
  .action(async (key, o) => {
    const eid = await resolveEngagementId(o.engagement);
    const result = o.resultType && o.resultId ? { type: o.resultType, id: o.resultId } : undefined;
    out(await repo.completeStep(eid, key, result));
  });

step
  .command("skip")
  .description("Skip a step with a reason")
  .argument("<key>", "Step key, e.g. enum.smb_enum")
  .requiredOption("--reason <reason>", "Why this step is being skipped")
  .option("--engagement <id>")
  .action(async (key, o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.skipStep(eid, key, o.reason));
  });

// --- activity --------------------------------------------------------------
const act = program.command("activity").description("Append-only audit trail");

act.command("log")
  .requiredOption("--phase <phase>", "scoping | recon | enum | exploit | postexploit | report")
  .requiredOption("--action <action>")
  .option("--command <command>")
  .option("--actor <actor>", "orchestrator | agent | human", "orchestrator")
  .option("--result <evidenceId>")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(
      await repo.logActivity({
        engagementId: eid,
        phase: o.phase,
        action: o.action,
        command: o.command,
        actor: o.actor,
        resultEvidenceId: o.result,
      }),
    );
  });

act.command("list")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listActivity(await resolveEngagementId(o.engagement))));

// --- event -------------------------------------------------------------------
const event = program.command("event").description("Domain events for reactive playbooks");

event
  .command("emit")
  .requiredOption("--type <type>", "event type, e.g. PortDiscovered")
  .requiredOption("--payload <json>", "JSON payload")
  .option("--source <source>", "event source", "cli")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(o.payload) as Record<string, unknown>;
    } catch {
      return program.error(`Invalid JSON payload: ${o.payload}`);
    }
    out(await repo.emitEvent(eid, o.type, payload, o.source));
  });

event
  .command("list")
  .option("--type <type>", "filter by event type")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.listEvents(eid, o.type ? { type: o.type } : undefined));
  });

// --- discovery ---------------------------------------------------------------
const discovery = program.command("discovery").description("Knowledge atoms (positive/negative/attempted)");

discovery
  .command("add")
  .requiredOption("--type <type>", "positive | negative | attempted")
  .requiredOption("--category <category>", "e.g. port, hostname, version, vuln")
  .requiredOption("--summary <summary>")
  .option("--detail <json>", "JSON detail object")
  .option("--source-event <id>", "source event UUID")
  .option("--parent <id>", "parent discovery UUID")
  .option("--engagement <id>")
  .action(async (o) => {
    const validTypes = ["positive", "negative", "attempted"];
    if (!validTypes.includes(o.type)) {
      return program.error(`Invalid type "${o.type}". Must be: ${validTypes.join(", ")}`);
    }
    const eid = await resolveEngagementId(o.engagement);
    let detail: Record<string, unknown> | undefined;
    if (o.detail) {
      try {
        detail = JSON.parse(o.detail) as Record<string, unknown>;
      } catch {
        return program.error(`Invalid JSON detail: ${o.detail}`);
      }
    }
    out(await repo.addDiscovery({
      engagementId: eid,
      type: o.type,
      category: o.category,
      summary: o.summary,
      detail,
      sourceEventId: o.sourceEvent,
      parentId: o.parent,
    }));
  });

discovery
  .command("list")
  .option("--category <category>", "filter by category")
  .option("--type <type>", "filter by type: positive | negative | attempted")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.listDiscoveries(eid, {
      category: o.category,
      type: o.type,
    }));
  });

// --- context (LLM context payload) ------------------------------------------
program
  .command("context")
  .description("Output the structured LLM context payload for the active engagement")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.getDiscoverySummary(eid));
  });

// --- supervisor ------------------------------------------------------------
program
  .command("supervisor")
  .description("Start the event-driven supervisor for an engagement")
  .option("--engagement <id>")
  .option("--mode <mode>", "Execution mode: race, standard, methodical, or learning")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    const validModes = ["race", "standard", "methodical", "learning"];
    if (o.mode && !validModes.includes(o.mode)) {
      console.error(`Invalid mode "${o.mode}". Valid modes: ${validModes.join(", ")}`);
      process.exit(1);
    }
    const { startSupervisor } = await import("@promptkiddie/supervisor");
    await startSupervisor({
      engagementId: eid,
      mode: o.mode,
      onEvent: (e) => console.log(`[event] ${e.type}: ${JSON.stringify(e.payload).slice(0, 100)}`),
      onActionStart: (name) => console.log(`[action] started: ${name}`),
      onActionEnd: (name) => console.log(`[action] finished: ${name}`),
      onOutput: (action, line) => console.log(`[${action}] ${line}`),
    });
  });

// --- agent run bookkeeping -------------------------------------------------
const agent = program.command("agent").description("Sub-agent run bookkeeping");

agent
  .command("start")
  .requiredOption("--agent <name>")
  .requiredOption("--phase <phase>")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.startAgentRun({ engagementId: eid, agent: o.agent, phase: o.phase }));
  });

agent
  .command("finish")
  .argument("<runId>")
  .requiredOption("--status <status>", "ok | failed")
  .option("--summary <text>")
  .action(async (runId, o) =>
    out(await repo.finishAgentRun({ runId, status: o.status, summary: o.summary })),
  );

// --- inbox (msg) -----------------------------------------------------------
const msg = program.command("msg").description("Human<->orchestrator message inbox");

msg
  .command("list")
  .description("List all messages for an engagement")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listMessages(await resolveEngagementId(o.engagement))));

msg
  .command("poll")
  .description("Fetch new inbound messages and mark them read")
  .option("--engagement <id>")
  .action(async (o) => {
    // Inbox messages may be engagement-scoped or global; only filter if asked.
    out(await repo.pollInbox(o.engagement));
  });

msg
  .command("send")
  .requiredOption("--body <body>")
  .option("--direction <direction>", "inbound | outbound", "outbound")
  .option("--author <author>")
  .option("--engagement <id>")
  .action(async (o) => {
    const engagementId = await resolveEngagementId(o.engagement);
    out(await repo.sendMessage({ body: o.body, direction: o.direction, author: o.author, engagementId }));
  });

// --- think (agent reasoning log) -------------------------------------------
program
  .command("think")
  .description("Log agent reasoning/thinking to the agent log")
  .argument("<message>", "what you're thinking, observing, or deciding")
  .option("--phase <phase>", "current phase", "recon")
  .option("--agent <name>", "agent name", "agent")
  .option("--category <cat>", "hypothesis | decision | observation | stuck | progress")
  .option("--engagement <id>")
  .action(async (message: string, o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.addAgentLog({
      engagementId: eid,
      agent: o.agent,
      phase: o.phase,
      message,
      category: o.category,
    }));
  });

// --- vpn (manage VPN profiles) -----------------------------------------------

const VPN_SUBNETS = ["10.129.0.0/16", "10.10.0.0/15", "10.13.37.0/24"];

function exec(cmd: string, args: string[], opts: { timeout?: number; stdio?: StdioOptions } = {}): string {
  return execFileSync(cmd, args, { timeout: opts.timeout ?? 10000, stdio: opts.stdio ?? "pipe" }).toString().trim();
}

function detectColima(): { isColima: boolean; vmIP: string | null } {
  try {
    const list = exec("colima", ["list", "--json"]);
    const info = JSON.parse(list);
    if (info?.status === "Running" && info?.address) {
      return { isColima: true, vmIP: info.address };
    }
  } catch {}
  return { isColima: false, vmIP: null };
}

function colimaExec(args: string, timeout = 15000): string {
  return execFileSync("colima", ["ssh", "--", "sudo", "sh", "-c", args],
    { timeout, stdio: "pipe" }).toString().trim();
}

function checkDualVPN() {
  try {
    const ps = exec("ps", ["aux"]);
    if (/OpenVPN Connect/i.test(ps)) {
      console.error("[vpn] WARNING: OpenVPN Connect is running on the host.");
      console.error("[vpn] Disconnect it to avoid routing conflicts.");
    }
  } catch {}
}

const vpn = program.command("vpn").description("Manage VPN connections");

function dockerExec(container: string) {
  return async (args: string[], timeout = 30000) => {
    const { execFile } = await import("node:child_process");
    return new Promise<string>((resolve, reject) => {
      execFile("docker", ["exec", container, ...args], { timeout }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });
  };
}

function listProfiles(): string[] {
  const vpnDir = config.vpn.config_path;
  try {
    return readdirSync(vpnDir)
      .filter((f) => f.endsWith(".ovpn"))
      .map((f) => f.replace(/\.ovpn$/, ""));
  } catch {
    return [];
  }
}

vpn
  .command("up")
  .description("Connect a VPN profile")
  .argument("[name]", "profile name (filename without .ovpn)")
  .action(async (name?: string) => {
    const profiles = listProfiles();

    if (profiles.length === 0) {
      console.error("[vpn] No .ovpn files found in " + config.vpn.config_path + "/");
      console.error("[vpn] Add one with: pk vpn add <name> /path/to/config.ovpn");
      process.exit(1);
    }

    if (!name) {
      if (profiles.length === 1) {
        name = profiles[0];
      } else {
        console.error("[vpn] Multiple profiles found. Specify one:");
        for (const p of profiles) console.error(`  pk vpn up ${p}`);
        process.exit(1);
      }
    }

    if (!profiles.includes(name)) {
      console.error(`[vpn] Profile "${name}" not found. Available: ${profiles.join(", ")}`);
      process.exit(1);
    }

    checkDualVPN();

    const colima = detectColima();
    const configFile = join(config.vpn.config_path, `${name}.ovpn`);
    const container = config.attackbox.container;
    const run = dockerExec(container);

    if (colima.isColima && colima.vmIP) {
      // --- macOS + Colima: VPN in the VM for transparent host routing ---
      console.error(`[vpn] Colima detected (${colima.vmIP}). Running VPN in VM for transparent host access.`);

      // Resolve absolute config path for VM (host fs is mounted)
      const absConfig = resolve(configFile);

      // Kill any existing VPN
      try { colimaExec("pkill -9 openvpn || true"); } catch {}
      // Also kill any VPN in the container to avoid dual connections
      try { await run(["sh", "-c", "pkill -9 openvpn || true"]); } catch {}
      await new Promise((r) => setTimeout(r, 500));

      // Start OpenVPN in VM
      console.error(`[vpn] Connecting profile "${name}"...`);
      let vmStarted = true;
      try {
        colimaExec(`openvpn --config "${absConfig}" --daemon --log /var/log/openvpn.log`);
      } catch (e: any) {
        console.error(`[vpn] Failed to start OpenVPN in VM: ${e.message}`);
        console.error("[vpn] Falling back to container mode...");
        vmStarted = false;
      }

      // Wait for tun0 (skip if openvpn failed to start)
      let tunIP = "";
      for (let i = 0; vmStarted && i < 30; i++) {
        try {
          const out = colimaExec("ip -4 addr show tun0");
          const m = out.match(/inet ([\d.]+)/);
          if (m) { tunIP = m[1]; break; }
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (tunIP) {
        console.error(`[vpn] Connected: tun0 = ${tunIP} [${name}]`);

        // Enable forwarding + NAT in VM
        try {
          colimaExec("echo 1 > /proc/sys/net/ipv4/ip_forward");
          colimaExec(
            "iptables -t nat -C POSTROUTING -o tun0 -j MASQUERADE 2>/dev/null || " +
            "iptables -t nat -A POSTROUTING -o tun0 -j MASQUERADE"
          );
          // Accept forwarded traffic on the routable interface (col0)
          colimaExec(
            "iptables -C FORWARD -i col0 -o tun0 -j ACCEPT 2>/dev/null || " +
            "iptables -A FORWARD -i col0 -o tun0 -j ACCEPT"
          );
          colimaExec(
            "iptables -C FORWARD -i tun0 -o col0 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || " +
            "iptables -A FORWARD -i tun0 -o col0 -m state --state RELATED,ESTABLISHED -j ACCEPT"
          );
        } catch {
          console.error("[vpn] Warning: could not configure VM forwarding");
        }

        // Add host routes
        const isMac = process.platform === "darwin";
        let routesNeeded = false;
        for (const subnet of VPN_SUBNETS) {
          try {
            if (isMac) {
              exec("sudo", ["route", "-n", "add", "-net", subnet, colima.vmIP!], { timeout: 15000, stdio: "inherit" });
            } else {
              exec("sudo", ["ip", "route", "add", subnet, "via", colima.vmIP!], { timeout: 15000, stdio: "inherit" });
            }
            routesNeeded = true;
          } catch {}
        }

        if (routesNeeded) {
          console.error(`[vpn] Host routes -> ${colima.vmIP} (transparent from host)`);
        } else {
          console.error(`[vpn] Host routes already configured (${colima.vmIP})`);
        }

        // Save state (sanitize for shell)
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
        try { colimaExec(`printf '%s' "${safeName}" > /tmp/.pk-vpn-profile`); } catch {}
        return;
      } else {
        console.error("[vpn] WARNING: tun0 not up in VM after 30s, falling back to container mode");
      }
    }

    // --- Linux / fallback: VPN in the container ---
    console.error("[vpn] Running VPN in attackbox container.");

    // Kill any running VPN and clean up stale tun devices
    try { await run(["pkill", "-9", "openvpn"]); } catch {}
    await new Promise((r) => setTimeout(r, 500));
    try {
      const links = await run(["sh", "-c", "ip -o link show | grep tun | awk -F: '{print $2}' | tr -d ' '"]);
      for (const dev of links.trim().split("\n").filter(Boolean)) {
        await run(["ip", "link", "delete", dev]);
      }
    } catch {}

    const configPath = `/vpn/${name}.ovpn`;
    console.error(`[vpn] Connecting profile "${name}"...`);
    await run(["openvpn", "--config", configPath, "--daemon", "--log", "/var/log/openvpn.log"]);
    await run(["sh", "-c", `echo "${name}" > /tmp/.pk-vpn-profile`]);

    for (let i = 0; i < 30; i++) {
      try {
        const out = await run(["ip", "-4", "addr", "show", "tun0"]);
        const match = out.match(/inet ([\d.]+)/);
        if (match) {
          console.error(`[vpn] Connected: tun0 = ${match[1]} [${name}]`);

          // On Linux, container IPs are routable - set up host routes
          if (process.platform === "linux") {
            try {
              const cIP = exec("docker", ["inspect", container, "--format",
                "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"]);
              if (cIP) {
                await run(["sh", "-c", "echo 1 > /proc/sys/net/ipv4/ip_forward"]);
                await run(["sh", "-c",
                  "iptables -t nat -C POSTROUTING -o tun0 -j MASQUERADE 2>/dev/null || " +
                  "iptables -t nat -A POSTROUTING -o tun0 -j MASQUERADE"
                ]);
                for (const subnet of VPN_SUBNETS) {
                  try {
                    exec("sudo", ["ip", "route", "add", subnet, "via", cIP],
                      { timeout: 15000, stdio: "inherit" });
                  } catch {}
                }
                console.error(`[vpn] Host routes -> ${cIP} (transparent from host)`);
              }
            } catch {}
          }
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.error("[vpn] WARNING: tun0 not up after 30s. Check: docker exec " + container + " cat /var/log/openvpn.log");
  });

vpn
  .command("down")
  .description("Disconnect the active VPN")
  .action(async () => {
    const container = config.attackbox.container;
    const run = dockerExec(container);
    const colima = detectColima();

    // Always kill VPN in the container (covers fallback mode)
    try { await run(["pkill", "-9", "openvpn"]); } catch {}
    try { await run(["rm", "-f", "/tmp/.pk-vpn-profile"]); } catch {}

    if (colima.isColima && colima.vmIP) {
      // Also kill VPN in VM and clean up host routes
      try { colimaExec("pkill -9 openvpn || true"); } catch {}
      try { colimaExec("rm -f /tmp/.pk-vpn-profile"); } catch {}

      const isMac = process.platform === "darwin";
      for (const subnet of VPN_SUBNETS) {
        try {
          if (isMac) {
            exec("sudo", ["route", "-n", "delete", "-net", subnet, colima.vmIP!],
              { timeout: 15000, stdio: "inherit" });
          } else {
            exec("sudo", ["ip", "route", "del", subnet, "via", colima.vmIP!],
              { timeout: 15000, stdio: "inherit" });
          }
        } catch {}
      }
      console.error("[vpn] Stopped (routes removed)");
    } else {
      console.error("[vpn] Stopped");
    }
  });

vpn
  .command("status")
  .description("Show active VPN connection and profile")
  .action(async () => {
    const container = config.attackbox.container;
    const run = dockerExec(container);
    const colima = detectColima();

    // Check VM first (Colima mode)
    if (colima.isColima) {
      try {
        const out = colimaExec("ip -4 addr show tun0 2>/dev/null || true");
        const ipMatch = out.match(/inet ([\d.]+)/);
        if (ipMatch) {
          let profile = "";
          try { profile = colimaExec("cat /tmp/.pk-vpn-profile 2>/dev/null || true").trim(); } catch {}
          console.log(profile
            ? `VPN: connected (${ipMatch[1]}) [${profile}] (VM mode, host transparent via ${colima.vmIP})`
            : `VPN: connected (${ipMatch[1]}) (VM mode, host transparent via ${colima.vmIP})`);
          return;
        }
      } catch {}
    }

    // Check container
    try {
      const out = await run(["ip", "-4", "addr", "show", "tun0"]);
      const ipMatch = out.match(/inet ([\d.]+)/);
      if (!ipMatch) { console.log("VPN: disconnected"); return; }
      let profile = "";
      try { profile = (await run(["cat", "/tmp/.pk-vpn-profile"])).trim(); } catch {}
      console.log(profile
        ? `VPN: connected (${ipMatch[1]}) [${profile}] (container mode)`
        : `VPN: connected (${ipMatch[1]}) (container mode)`);
    } catch {
      console.log("VPN: disconnected");
    }
  });

vpn
  .command("list")
  .description("List available VPN profiles")
  .action(async () => {
    const profiles = listProfiles();
    if (profiles.length === 0) {
      console.error("No .ovpn files in " + config.vpn.config_path + "/");
      console.error("Add one with: pk vpn add <name> /path/to/config.ovpn");
      return;
    }
    let activeProfile = "";
    try {
      const container = config.attackbox.container;
      const run = dockerExec(container);
      activeProfile = (await run(["cat", "/tmp/.pk-vpn-profile"])).trim();
    } catch {}
    for (const p of profiles) {
      const marker = p === activeProfile ? " (active)" : "";
      console.log(`  ${p}${marker}`);
    }
  });

vpn
  .command("add")
  .description("Import a .ovpn file as a named profile")
  .argument("<name>", "profile name")
  .argument("<path>", "path to .ovpn file")
  .action(async (name: string, srcPath: string) => {
    if (!existsSync(srcPath)) {
      console.error(`[vpn] File not found: ${srcPath}`);
      process.exit(1);
    }
    const dest = join(config.vpn.config_path, `${name}.ovpn`);
    copyFileSync(srcPath, dest);
    console.error(`[vpn] Added profile "${name}" -> ${dest}`);
  });

// --- tmux (sessions inside containers, formerly "shell") ---------------------
const tmux = program.command("tmux").description("Manage tmux sessions inside containers");

tmux
  .command("new")
  .description("Create a named tmux session in the active container")
  .argument("<name>", "session name")
  .option("--container <name>", "container to use (default: active phase container)")
  .action(async (name: string, o) => {
    const container = o.container ?? config.attackbox.container;
    const { spawnSync } = await import("node:child_process");
    spawnSync("docker", ["exec", container, "tmux", "new-session", "-d", "-s", name], { stdio: "inherit" });
    console.log(`Session '${name}' created in ${container}`);
  });

tmux
  .command("attach")
  .description("Attach to a tmux session")
  .argument("<name>", "session name")
  .option("--container <name>")
  .action(async (name: string, o) => {
    const container = o.container ?? config.attackbox.container;
    const { spawnSync } = await import("node:child_process");
    spawnSync("docker", ["exec", "-it", container, "tmux", "attach-session", "-t", name], { stdio: "inherit" });
  });

tmux
  .command("list")
  .description("List tmux sessions")
  .option("--container <name>")
  .action(async (o) => {
    const container = o.container ?? config.attackbox.container;
    const { execFile: exec } = await import("node:child_process");
    exec("docker", ["exec", container, "tmux", "list-sessions"], (err, stdout) => {
      if (err) { console.log("No active sessions"); return; }
      console.log(stdout);
    });
  });

tmux
  .command("kill")
  .description("Kill a tmux session")
  .argument("<name>", "session name")
  .option("--container <name>")
  .action(async (name: string, o) => {
    const container = o.container ?? config.attackbox.container;
    const { execFile: exec } = await import("node:child_process");
    exec("docker", ["exec", container, "tmux", "kill-session", "-t", name], (err) => {
      if (err) console.error(`Failed to kill session: ${err.message}`);
      else console.log(`Session '${name}' killed`);
    });
  });

// --- webshell (registered webshell sessions) ---------------------------------
const ws = program.command("webshell").description("Manage webshell sessions (auto-logged)");

ws.command("register")
  .description("Register a webshell URL for the active engagement")
  .argument("<url>", "webshell URL, e.g. http://target/shell.php")
  .option("--name <name>", "short name for this webshell")
  .option("--param <param>", "query/post parameter name for commands", "cmd")
  .option("--engagement <id>")
  .action(async (url: string, o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await repo.registerWebshell(eid, { name: o.name ?? "", url, param: o.param }));
  });

ws.command("list")
  .description("List registered webshells for the active engagement")
  .option("--engagement <id>")
  .action(async (o) => out(await repo.listWebshells(await resolveEngagementId(o.engagement))));

ws.command("exec")
  .description("Execute a command via a registered webshell (auto-logged)")
  .argument("<shell>", "webshell name or URL")
  .argument("<command...>", "command to execute on target")
  .option("--method <method>", "HTTP method: GET or POST", "POST")
  .option("--max-output <bytes>", "max bytes returned to caller", parseInt, 4096)
  .option("--engagement <id>")
  .action(async (shellName: string, command: string[], o) => {
    const eid = await resolveEngagementId(o.engagement);
    const shell = await repo.getWebshell(eid, shellName) as { name: string; url: string; param: string } | null;
    if (!shell) throw new Error(`No webshell "${shellName}". Run: pk webshell register <url> --name ${shellName}`);

    const cmdStr = command.join(" ");
    const start = Date.now();
    const container = config.attackbox.container;

    const { execFile: exec } = await import("node:child_process");
    const curlArgs = o.method === "GET"
      ? ["curl", "-s", `${shell.url}?${shell.param}=${encodeURIComponent(cmdStr)}`]
      : ["curl", "-s", shell.url, "--data-urlencode", `${shell.param}=${cmdStr}`];

    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      exec(
        "docker",
        ["exec", "-e", "PK_EXEC=1", container, ...curlArgs],
        { maxBuffer: 10 * 1024 * 1024, timeout: 300000 },
        (err, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
          });
        },
      );
    });

    const duration = Date.now() - start;
    const eng = await repo.getEngagement(eid) as { phase?: string } | null;
    const phase_ = eng?.phase ?? "exploit";

    await repo.logActivity({
      engagementId: eid,
      phase: phase_,
      action: `[webshell:${shell.name}] ${cmdStr} (${duration}ms, exit ${result.code})`,
      command: `pk webshell exec ${shell.name} ${cmdStr}`,
      actor: "agent",
    });

    await repo.recordExecOutcome(eid, `webshell:${shell.name} ${cmdStr}`, shell.url, result.code).catch(() => {});

    const fullOutput = result.stdout + result.stderr;
    const maxBytes = o.maxOutput;

    if (fullOutput.length > maxBytes) {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const engRow = await getEngagement(eid);
      const slug = engRow?.slug ?? eid;
      const dir = `engagements/${slug}/webshell`;
      mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath = `${dir}/${shell.name}-${ts}.txt`;
      writeFileSync(outPath, fullOutput);
      await addEvidence({ engagementId: eid, path: outPath, type: "output" });

      process.stdout.write(fullOutput.slice(0, maxBytes));
      process.stderr.write(`\n[truncated: ${fullOutput.length} bytes total, full output at ${outPath}]\n`);
    } else {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    process.exitCode = result.code;
  });

// --- gleipnir (reverse shell sessions) --------------------------------------

const GLEIPNIR_SOCK = process.env.PK_GLEIPNIR_SOCK ?? "/tmp/gleipnir.sock";

async function gleipnirApi(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const client = net.createConnection(GLEIPNIR_SOCK, () => {
      client.write(JSON.stringify(request) + "\n");
    });
    let data = "";
    client.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    client.on("end", () => {
      try { resolve(JSON.parse(data.trim())); }
      catch { reject(new Error(`invalid response: ${data}`)); }
    });
    client.on("error", (err: Error) => {
      reject(new Error(`gleipnir relay not reachable (${GLEIPNIR_SOCK}): ${err.message}`));
    });
  });
}

const shell = program.command("shell").description("Execute commands on gleipnir sessions");

shell
  .command("list")
  .description("List active gleipnir sessions")
  .action(async () => {
    const resp = await gleipnirApi({ action: "sessions" });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    const sessions = resp.data as Array<Record<string, unknown>>;
    if (sessions.length === 0) { console.log("No active sessions"); return; }
    for (const s of sessions) {
      const status = s.connected ? "connected" : "disconnected";
      console.log(`  ${s.name}\t${s.os}/${s.arch}\t${s.username}@${s.hostname}\t${status}`);
    }
  });

shell
  .command("exec")
  .description("Execute a command on a gleipnir session")
  .argument("<session>", "session name")
  .argument("<command...>", "command to execute")
  .option("--timeout <seconds>", "command timeout", "300")
  .action(async (session: string, command: string[], o) => {
    const cmd = command.join(" ");
    const resp = await gleipnirApi({
      action: "exec",
      session,
      command: cmd,
      timeout: parseInt(o.timeout, 10),
    });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    const output = (resp.data as Record<string, string>).output;
    process.stdout.write(output);
    if (!output.endsWith("\n")) process.stdout.write("\n");

    try {
      const eid = await resolveEngagementId(undefined);
      await repo.logActivity({
        engagementId: eid,
        phase: "exploit",
        action: `gleipnir exec on ${session}: ${cmd}`,
        command: `pk shell exec ${session} ${cmd}`,
      });
    } catch { /* no active engagement, skip logging */ }
  });

shell
  .command("attach")
  .description("Interactive shell on a gleipnir session")
  .argument("<session>", "session name")
  .option("--timeout <seconds>", "command timeout", "300")
  .action(async (session: string, o) => {
    const timeout = parseInt(o.timeout, 10);
    const { createInterface } = await import("node:readline");

    // Verify session exists and is connected
    const check = await gleipnirApi({ action: "session", name: session });
    if (!check.ok) { console.error(`Error: ${check.error}`); process.exit(1); }
    const info = check.data as Record<string, unknown>;
    if (!info.connected) { console.error(`Session '${session}' is disconnected`); process.exit(1); }
    console.log(`Connected to ${info.username}@${info.hostname} (${info.os}/${info.arch})`);
    console.log(`Type 'exit' to disconnect. 'upload <local> <remote>' / 'download <remote> <local>' for file transfer.\n`);

    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: `gleipnir:${session}> ` });
    rl.prompt();

    rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) { rl.prompt(); return; }

      if (trimmed === "exit" || trimmed === "quit") {
        rl.close();
        return;
      }

      if (trimmed.startsWith("upload ")) {
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 3) { console.error("Usage: upload <local-src> <remote-dst>"); rl.prompt(); return; }
        const resp = await gleipnirApi({ action: "upload", session, src: parts[1], dst: parts[2] });
        if (resp.ok) console.log(`Uploaded ${parts[1]} -> ${parts[2]}`);
        else console.error(`\x1b[31mError: ${resp.error}\x1b[0m`);
        rl.prompt();
        return;
      }

      if (trimmed.startsWith("download ")) {
        const parts = trimmed.split(/\s+/);
        if (parts.length !== 3) { console.error("Usage: download <remote-src> <local-dst>"); rl.prompt(); return; }
        const resp = await gleipnirApi({ action: "download", session, src: parts[1], dst: parts[2] });
        if (resp.ok) {
          const data = resp.data as Record<string, unknown>;
          console.log(`Downloaded ${parts[1]} -> ${parts[2]} (${data.size} bytes)`);
        } else {
          console.error(`\x1b[31mError: ${resp.error}\x1b[0m`);
        }
        rl.prompt();
        return;
      }

      const resp = await gleipnirApi({ action: "exec", session, command: trimmed, timeout });
      if (resp.ok) {
        const data = resp.data as Record<string, unknown>;
        const output = (data.output ?? "") as string;
        if (output) {
          process.stdout.write(output);
          if (!output.endsWith("\n")) process.stdout.write("\n");
        }
      } else {
        console.error(`\x1b[31mError: ${resp.error}\x1b[0m`);
      }
      rl.prompt();
    });

    rl.on("close", () => {
      console.log("\nDisconnected.");
      process.exit(0);
    });

    // Keep the event loop alive
    await new Promise(() => {});
  });

shell
  .command("info")
  .description("Show details for a gleipnir session")
  .argument("<session>", "session name")
  .action(async (session: string) => {
    const resp = await gleipnirApi({ action: "session", name: session });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    const s = resp.data as Record<string, unknown>;
    console.log(`Session:   ${s.name}`);
    console.log(`Host:      ${s.username}@${s.hostname}`);
    console.log(`Platform:  ${s.os}/${s.arch}`);
    console.log(`PID:       ${s.pid}`);
    console.log(`CWD:       ${s.cwd}`);
    console.log(`Status:    ${s.connected ? "connected" : "disconnected"}`);
  });

program
  .command("upload")
  .description("Upload a file to a target via gleipnir session")
  .argument("<session>", "session name")
  .argument("<src>", "local source file path")
  .argument("<dst>", "remote destination path")
  .action(async (session: string, src: string, dst: string) => {
    const resp = await gleipnirApi({ action: "upload", session, src, dst });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    const data = resp.data as Record<string, unknown>;
    const sizeKb = ((data.size as number) / 1024).toFixed(1);
    console.log(`Uploaded ${src} -> ${dst} (${sizeKb} KB, ${data.elapsed_ms}ms)`);
  });

program
  .command("download")
  .description("Download a file from a target via gleipnir session")
  .argument("<session>", "session name")
  .argument("<src>", "remote source file path")
  .argument("<dst>", "local destination path")
  .action(async (session: string, src: string, dst: string) => {
    const resp = await gleipnirApi({ action: "download", session, src, dst });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    const data = resp.data as Record<string, unknown>;
    console.log(`Downloaded ${src} -> ${dst} (${data.size} bytes)`);
  });

const tunnel = program.command("tunnel").description("Manage SOCKS tunnels through gleipnir sessions");

tunnel
  .command("up")
  .description("Start a SOCKS5 proxy through a gleipnir session")
  .argument("<session>", "session name")
  .option("--socks <port>", "local SOCKS port", "1080")
  .action(async (session: string, o) => {
    const port = parseInt(o.socks, 10);
    const resp = await gleipnirApi({ action: "socks", session, port });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    console.log(`SOCKS5 proxy for '${session}' listening on 127.0.0.1:${port}`);
    console.log(`  proxychains: socks5 127.0.0.1 ${port}`);
  });

tunnel
  .command("down")
  .description("Stop a SOCKS tunnel")
  .argument("<session>", "session name")
  .action(async (session: string) => {
    const resp = await gleipnirApi({ action: "socks", session, port: 0, stop: true });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    console.log(`Tunnel for '${session}' stopped`);
  });

tunnel
  .command("status")
  .description("List active SOCKS tunnels")
  .action(async () => {
    const resp = await gleipnirApi({ action: "tunnels" });
    if (!resp.ok) { console.error(`Error: ${resp.error}`); process.exit(1); }
    const tunnels = resp.data as Array<Record<string, unknown>>;
    if (tunnels.length === 0) { console.log("No active tunnels"); return; }
    for (const t of tunnels) {
      console.log(`  ${t.session}\t127.0.0.1:${t.port}`);
    }
  });

// --- agent binaries --------------------------------------------------------

const AGENT_DIR = process.env.PK_AGENT_DIR ?? "/opt/gleipnir/agents";

const agentCmd = program.command("agents").description("Manage gleipnir agent binaries");

agentCmd
  .command("list")
  .description("List available pre-compiled agent binaries")
  .action(async () => {
    const { readdirSync: readDir, statSync } = await import("node:fs");
    try {
      const files = readDir(AGENT_DIR).filter((f: string) => f.startsWith("pk-agent-"));
      if (files.length === 0) {
        console.log(`No agent binaries found in ${AGENT_DIR}`);
        console.log("Build with CI or place binaries manually.");
        return;
      }
      for (const f of files) {
        const size = statSync(`${AGENT_DIR}/${f}`).size;
        const kb = (size / 1024).toFixed(0);
        console.log(`  ${f}\t${kb} KB`);
      }
    } catch {
      console.error(`Agent directory not found: ${AGENT_DIR}`);
      console.error("Set PK_AGENT_DIR or build the attackbox image.");
      process.exit(1);
    }
  });

agentCmd
  .command("path")
  .description("Print path to an agent binary for upload")
  .argument("<target>", "target spec, e.g. linux-amd64, linux-arm64-tls, windows-amd64")
  .action(async (target: string) => {
    const { existsSync: exists } = await import("node:fs");
    const name = target.startsWith("pk-agent-") ? target : `pk-agent-${target}`;
    const candidates = [name, `${name}.exe`];
    for (const c of candidates) {
      const full = `${AGENT_DIR}/${c}`;
      if (exists(full)) {
        console.log(full);
        return;
      }
    }
    console.error(`No agent binary found for '${target}' in ${AGENT_DIR}`);
    console.error("Available targets: linux-amd64, linux-amd64-tls, linux-arm64, linux-arm64-tls, windows-amd64, windows-amd64-tls");
    process.exit(1);
  });

// --- events (Docker exec watcher) ------------------------------------------
const events = program.command("events").description("Docker container event monitoring");

events
  .command("watch")
  .description("Stream exec events from PK containers and log to the engagement DB")
  .option("--engagement <id>")
  .option("--phase <phase>", "override phase for all logged events")
  .action(async (o) => {
    const { startExecWatcher } = await import("@promptkiddie/core");
    const eid = await resolveEngagementId(o.engagement);
    const ac = new AbortController();

    console.error(`[exec-watcher] Watching PK containers for engagement ${eid}`);
    console.error("[exec-watcher] Press Ctrl+C to stop\n");

    const watcher = startExecWatcher({
      engagementId: eid,
      phase: o.phase,
      signal: ac.signal,
      onExec: (entry) => {
        const exit = entry.exitCode === 0 ? "\x1b[32m0\x1b[0m" : `\x1b[31m${entry.exitCode}\x1b[0m`;
        console.log(
          `\x1b[33m${entry.service}\x1b[0m  ${entry.tool}  exit:${exit}  ${entry.durationMs}ms` +
          `\n  \x1b[90m${entry.cmd}\x1b[0m`,
        );
      },
    });

    process.on("SIGINT", () => { watcher.stop(); process.exit(0); });
    process.on("SIGTERM", () => { watcher.stop(); process.exit(0); });

    // Keep process alive
    await new Promise(() => {});
  });

// --- knowledge (RAG technique search) --------------------------------------
const knowledge = program.command("knowledge").description("Technique knowledge base (vector + keyword search)");

knowledge
  .command("pull")
  .description("Clone and ingest a registered knowledge source (clones inside Docker to avoid AV)")
  .argument("[source]", "Source name (PayloadsAllTheThings, GTFObins, HackTricks) or --all")
  .option("--all", "Pull all registered sources")
  .option("--container <name>", "Docker container to clone inside", config.attackbox.container)
  .action(async (sourceName, o) => {
    const { KNOWLEDGE_SOURCES, getKnowledgeSource, ingestDocument, clearSource } = await import("@promptkiddie/core");
    const container = o.container;

    const sources = o.all ? KNOWLEDGE_SOURCES : sourceName ? [getKnowledgeSource(sourceName)].filter(Boolean) : [];
    if (sources.length === 0) {
      console.error("Available sources:", KNOWLEDGE_SOURCES.map((s) => s.name).join(", "));
      process.exit(1);
    }

    const dockerExec = (cmd: string): string => {
      try {
        return execFileSync("docker", ["exec", container, "sh", "-c", cmd], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120000,
        }).toString();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("stdout maxBuffer")) return "";
        throw err;
      }
    };

    for (const src of sources) {
      if (!src) continue;
      const tmpDir = `/tmp/pk-kb-${src.name.toLowerCase().replace(/\s+/g, "-")}`;

      console.error(`[knowledge] Cloning ${src.name} inside ${container}...`);
      dockerExec(`rm -rf ${tmpDir}`);
      try {
        execFileSync("docker", ["exec", container, "git", "clone", "--depth", "1", src.repo, tmpDir], {
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 120000,
        });
      } catch (err) {
        console.error(`[knowledge] Failed to clone: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      console.error(`[knowledge] Clearing old ${src.name} chunks...`);
      const cleared = await clearSource(src.name);
      if (cleared > 0) console.error(`[knowledge] Removed ${cleared} old chunks`);

      let totalFiles = 0;
      let totalChunks = 0;
      let errors = 0;

      for (const subPath of src.paths) {
        const ingestDir = subPath === "." ? tmpDir : `${tmpDir}/${subPath}`;
        const extArgs = src.extensions.map((e) => `-name "*${e}"`).join(" -o ");
        const findCmd = extArgs
          ? `find ${ingestDir} -type f \\( ${extArgs} \\) 2>/dev/null`
          : `find ${ingestDir} -type f -not -name ".*" 2>/dev/null`;

        const fileList = dockerExec(findCmd).trim().split("\n").filter(Boolean);
        console.error(`[knowledge] Found ${fileList.length} files in ${subPath}`);

        for (const filePath of fileList) {
          try {
            const content = dockerExec(`cat "${filePath}"`);
            if (content.trim().length < 50) continue;

            const relPath = filePath.replace(tmpDir + "/", "");
            const chunks = await ingestDocument(content, {
              source: src.name,
              category: relPath.split("/")[0],
              path: relPath,
            }, src.chunkStrategy);

            totalFiles++;
            totalChunks += chunks;
            if (totalFiles % 20 === 0) console.error(`  ${totalFiles} files, ${totalChunks} chunks...`);
          } catch {
            errors++;
          }
        }
      }

      dockerExec(`rm -rf ${tmpDir}`);
      console.error(`[knowledge] ${src.name}: ${totalFiles} files, ${totalChunks} chunks, ${errors} errors`);
    }
  });

knowledge
  .command("ingest")
  .description("Ingest an arbitrary directory of technique docs")
  .argument("<path>", "Directory to ingest")
  .requiredOption("--source <name>", "Source name for tracking")
  .option("--strategy <s>", "Chunk strategy: heading, file, fixed", "heading")
  .option("--ext <exts>", "File extensions (comma-separated)", ".md,.txt")
  .action(async (dirPath, o) => {
    const { ingestDirectory } = await import("@promptkiddie/core");
    const result = await ingestDirectory(dirPath, {
      source: o.source,
      extensions: o.ext.split(","),
      chunkStrategy: o.strategy,
      onProgress: (file, chunks) => console.error(`  ${file} (${chunks} chunks)`),
    });
    console.error(`Ingested: ${result.files} files, ${result.chunks} chunks, ${result.skipped} skipped`);
    if (result.errors.length > 0) result.errors.forEach((e) => console.error(`  ERROR: ${e}`));
  });

knowledge
  .command("search")
  .description("Search the knowledge base")
  .argument("<query>", "Search query")
  .option("--limit <n>", "Max results", "5")
  .option("--mode <m>", "Search mode: hybrid, vector, keyword", "hybrid")
  .option("--source <s>", "Filter by source name")
  .action(async (query, o) => {
    const { searchKnowledge } = await import("@promptkiddie/core");
    const results = await searchKnowledge(query, {
      limit: parseInt(o.limit, 10),
      mode: o.mode,
      source: o.source,
    });
    if (results.length === 0) {
      console.log("No results found.");
      return;
    }
    for (const r of results) {
      console.log(`\n--- ${r.source}${r.path ? ` / ${r.path}` : ""} (${r.matchType}, score: ${r.score.toFixed(4)}) ---`);
      console.log(r.content.slice(0, 500) + (r.content.length > 500 ? "\n..." : ""));
    }
  });

knowledge
  .command("sources")
  .description("List ingested knowledge sources with chunk counts")
  .action(async () => {
    const { listSources } = await import("@promptkiddie/core");
    const sources = await listSources();
    if (sources.length === 0) {
      console.log("No sources ingested. Run: pk knowledge pull --all");
      return;
    }
    for (const s of sources) {
      console.log(`${s.source}: ${s.chunks} chunks (last updated ${s.lastIngested.toISOString().split("T")[0]})`);
    }
  });

knowledge
  .command("clear")
  .description("Remove all chunks from a source")
  .requiredOption("--source <name>", "Source name to clear")
  .action(async (o) => {
    const { clearSource } = await import("@promptkiddie/core");
    const count = await clearSource(o.source);
    console.log(`Cleared ${count} chunks from ${o.source}`);
  });

// --- exec (run command + auto-log) -----------------------------------------
const DEFAULT_CONTAINER = config.attackbox.container;
const USE_DOCKER = config.attackbox.exec_mode !== "local";

const ATTACK_CONTAINER = process.env.PK_ATTACK_CONTAINER ?? "promptkiddie-attack";
const PHASE_CONTAINERS: Record<string, string> = {
  recon: process.env.PK_RECON_CONTAINER ?? "promptkiddie-recon",
  enum: ATTACK_CONTAINER,
  exploit: ATTACK_CONTAINER,
  postexploit: ATTACK_CONTAINER,
};

async function resolveContainer(phase?: string): Promise<string> {
  if (!phase || !PHASE_CONTAINERS[phase]) return DEFAULT_CONTAINER;
  const target = PHASE_CONTAINERS[phase];
  const { execFile: exec } = await import("node:child_process");
  return new Promise((resolve) => {
    exec("docker", ["inspect", "--format", "{{.State.Running}}", target], (err, stdout) => {
      resolve(stdout?.trim() === "true" ? target : DEFAULT_CONTAINER);
    });
  });
}

program
  .command("exec")
  .description("Run a command and auto-log it. Uses Docker container by default, --local for host.")
  .option("--phase <phase>", "override phase (default: read from active engagement)")
  .option("--agent <name>", "agent name for attribution", "agent")
  .option("--host", "run on the host instead of in the Docker container")
  .option("--reason <reason>", "why this command is being run (logged to activity)")
  .option("--max-output <bytes>", "max bytes returned to caller (full output saved to file)", parseInt, 4096)
  .option("--script <path>", "copy a local script into the container and run it (avoids quoting issues)")
  .option("--engagement <id>")
  .argument("<command...>", "command to run")
  .action(async (cmd: string[], o) => {
    const eid = await resolveEngagementId(o.engagement);
    const eng = await repo.getEngagement(eid) as { phase?: string } | null;
    const phase = o.phase ?? eng?.phase ?? "recon";
    const start = Date.now();
    const local = o.host || !USE_DOCKER;
    const container = local ? "" : await resolveContainer(phase);

    const { execFile: exec } = await import("node:child_process");

    // Script mode: copy file into container, run it, clean up
    let cmdStr: string;
    if (o.script && !local) {
      const remotePath = `/tmp/pk-script-${Date.now()}.sh`;
      const { execFileSync } = await import("node:child_process");
      execFileSync("docker", ["cp", o.script, `${container}:${remotePath}`]);
      execFileSync("docker", ["exec", container, "chmod", "+x", remotePath]);
      const scriptArgs = cmd.length ? " " + cmd.join(" ") : "";
      cmdStr = `${remotePath}${scriptArgs}; rm -f ${remotePath}`;
    } else {
      cmdStr = cmd.join(" ");
    }

    const needsShell = /[|&;<>`$"'\\*?#~(){}[\]!\n]/.test(cmdStr) || o.script;

    const execArgs: [string, string[]] = local
      ? ["sh", ["-c", cmdStr]]
      : needsShell
        ? ["docker", ["exec", "-e", "PK_EXEC=1", container, "sh", "-c", cmdStr]]
        : ["docker", ["exec", "-e", "PK_EXEC=1", container, ...cmd]];

    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      const proc = exec(
        execArgs[0],
        execArgs[1],
        { maxBuffer: 10 * 1024 * 1024, timeout: 300000 },
        (err, stdout, stderr) => {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
          });
        },
      );
      proc.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 1 }));
    });

    const duration = Date.now() - start;
    const toolName = cmdStr.split(/\s+/)[0];
    const reasonSuffix = o.reason ? ` | ${o.reason}` : "";
    const combined = result.stdout + result.stderr;

    const isNotFound = result.code === 127 ||
      combined.includes("not found") ||
      combined.includes("No such file or directory");

    if (isNotFound && !local && container !== DEFAULT_CONTAINER) {
      process.stderr.write(
        `[pk] Command "${toolName}" not available in ${container} (${o.phase} image).\n` +
        `[pk] Retrying on full attackbox (${DEFAULT_CONTAINER})...\n`
      );

      await repo.logActivity({
        engagementId: eid,
        phase: phase,
        action: `[${o.agent}] ${toolName} not found in ${container}, retrying on ${DEFAULT_CONTAINER}`,
        command: cmdStr,
        actor: "agent",
      });

      const retry = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const proc = exec(
          "docker", ["exec", "-e", "PK_EXEC=1", DEFAULT_CONTAINER, "sh", "-c", cmdStr],
          { maxBuffer: 10 * 1024 * 1024, timeout: 300000 },
          (err, stdout, stderr) => {
            resolve({
              stdout: stdout ?? "",
              stderr: stderr ?? "",
              code: err && "code" in err ? (err.code as number) : err ? 1 : 0,
            });
          },
        );
        proc.on("error", (err) => resolve({ stdout: "", stderr: err.message, code: 1 }));
      });

      const retryNotFound = retry.code === 127 ||
        (retry.stdout + retry.stderr).includes("not found");

      if (retryNotFound) {
        process.stderr.write(
          `[pk] "${toolName}" not available in any container. Install it with: pk exec -- apt-get install <package>\n`
        );
      }

      Object.assign(result, retry);
    } else if (isNotFound) {
      process.stderr.write(
        `[pk] "${toolName}" not found in ${local ? "host" : container}. ` +
        `Install it with: ${local ? "apt-get install <package>" : "pk exec -- apt-get install <package>"}\n`
      );
    }

    await repo.logActivity({
      engagementId: eid,
      phase: phase,
      action: `[${o.agent}] ${toolName} (${duration}ms, exit ${result.code})${reasonSuffix}`,
      command: cmdStr,
      actor: "agent",
    });

    const target = local ? "localhost" : container;
    await repo.recordExecOutcome(eid, cmdStr, target, result.code).catch(() => {});

    const fullOutput = result.stdout + result.stderr;
    const maxBytes = o.maxOutput;

    if (fullOutput.length > maxBytes) {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const eng = await getEngagement(eid);
      const slug = eng?.slug ?? eid;
      const dir = `engagements/${slug}/exec`;
      mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath = `${dir}/${toolName}-${ts}.txt`;
      writeFileSync(outPath, fullOutput);
      await addEvidence({ engagementId: eid, path: outPath, type: "output" });

      process.stdout.write(fullOutput.slice(0, maxBytes));
      process.stderr.write(`\n[truncated: ${fullOutput.length} bytes total, full output at ${outPath}]\n`);
    } else {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    process.exitCode = result.code;
  });

// --- build (x86_64 build sidecar commands) ---------------------------------
const build = program.command("build").description("Cross-compile tools using the x86_64 builder sidecar");

build
  .command("donut")
  .description("Generate position-independent shellcode from a PE executable using donut")
  .argument("<input>", "path to the input .exe file")
  .option("--arch <n>", "target arch: 1=x86, 2=amd64, 3=both", "2")
  .option("--bypass <n>", "AMSI/WLDP bypass: 1=none, 2=abort, 3=continue", "3")
  .option("--format <n>", "output format: 1=bin, 2=base64, 3=c, 4=ruby, 5=python, 6=powershell, 7=csharp, 8=hex", "1")
  .option("--class <name>", ".NET class name")
  .option("--method <name>", ".NET method name")
  .option("--params <args>", "command-line params for the payload")
  .option("--output <name>", "output filename (relative to .build/)", "payload.bin")
  .action(async (input: string, o) => {
    const { resolve, basename } = await import("node:path");
    const { existsSync: exists, mkdirSync, copyFileSync: cpSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");

    const inputPath = resolve(input);
    if (!exists(inputPath)) {
      console.error(`[build] Input file not found: ${inputPath}`);
      process.exit(1);
    }

    const buildDir = resolve(process.cwd(), ".build");
    mkdirSync(buildDir, { recursive: true });

    const inputName = basename(inputPath);
    cpSync(inputPath, join(buildDir, inputName));

    // Ensure the builder container is running
    console.error("[build] Starting builder-x86 container...");
    try {
      execSync("docker compose --profile build up -d builder-x86", {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120000,
      });
    } catch (err) {
      console.error(`[build] Failed to start builder container: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    // Build the donut command
    const donutArgs: string[] = ["-f", `/build/${inputName}`];
    donutArgs.push("-a", o.arch);
    donutArgs.push("-b", o.bypass);
    donutArgs.push("-t", o.format);
    donutArgs.push("-o", `/build/${o.output}`);
    if (o.class) donutArgs.push("-c", o.class);
    if (o.method) donutArgs.push("-m", o.method);
    if (o.params) donutArgs.push("-p", o.params);

    const donutCmd = `python3 -m donut ${donutArgs.join(" ")}`;
    console.error(`[build] Running: ${donutCmd}`);

    try {
      const result = execSync(
        `docker compose exec builder-x86 ${donutCmd}`,
        { encoding: "utf-8", timeout: 120000 },
      );
      if (result.trim()) console.log(result.trim());
    } catch (err) {
      console.error(`[build] donut failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    const outPath = join(buildDir, o.output);
    if (exists(outPath)) {
      console.error(`[build] Output: ${outPath}`);
    } else {
      console.error(`[build] Warning: expected output not found at ${outPath}`);
    }
  });

// --- init (scaffold workspace) ---------------------------------------------
program
  .command("init")
  .description("Scaffold a PromptKiddie workspace in the current directory")
  .option("--harness <harness>", "AI harness: claude-code | opencode | pi")
  .option("--db-url <url>", "PostgreSQL connection string")
  .option("--api-secret <secret>", "API bearer token secret")
  .option("--skip-docker", "skip starting Docker services")
  .option("-y, --yes", "accept all defaults without prompting")
  .action(async (o) => {
    const { runInit } = await import("./init.js");
    await runInit({ harness: o.harness, dbUrl: o.dbUrl, apiSecret: o.apiSecret, skipDocker: o.skipDocker, yes: o.yes });
  });

// --- config (show resolved configuration) ----------------------------------
program
  .command("config")
  .description("Show the resolved configuration (defaults + global + workspace + env)")
  .action(async () => out(config));

// --- search (grep stored exec outputs) -------------------------------------
program
  .command("search")
  .description("Search stored exec outputs for a term")
  .argument("<term>", "search term")
  .option("--engagement <id>")
  .action(async (term: string, o) => {
    const eid = await resolveEngagementId(o.engagement);
    const eng = await getEngagement(eid);
    const slug = eng?.slug ?? eid;
    const dir = `engagements/${slug}`;
    const { execSync } = await import("node:child_process");
    try {
      const result = execSync(`grep -rn "${term.replace(/"/g, '\\"')}" "${dir}"`, {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 30000,
      });
      process.stdout.write(result);
    } catch (err: unknown) {
      const e = err as { stdout?: string; status?: number };
      if (e.stdout) process.stdout.write(e.stdout);
      else console.error("No matches found.");
    }
  });

// --- report ----------------------------------------------------------------
const report = program.command("report").description("Generate engagement reports");

report
  .command("generate")
  .description("Generate a PDF report for an engagement")
  .option("--engagement <id>")
  .option("--output <path>", "output directory for the report files")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    // Resolve project root: walk up from this script until we find package.json with "workspaces"
    const { resolve, dirname } = await import("node:path");
    const { existsSync: exists, readFileSync: readF } = await import("node:fs");
    let dir = resolve(process.cwd());
    while (dir !== "/") {
      const pkg = resolve(dir, "pnpm-workspace.yaml");
      if (exists(pkg)) break;
      dir = dirname(dir);
    }
    if (dir === "/") dir = process.cwd();

    console.error(`[report] Generating report for engagement ${eid}...`);
    const result = await generateReport(eid, dir, o.output);
    console.error(`[report] .typ: ${result.typPath}`);
    console.error(`[report] .pdf: ${result.pdfPath}`);
    console.log(result.pdfPath);
  });

// --- spawn (dynamic container provisioning) ----------------------------------
const spawn = program.command("spawn").description("Spawn agent/orchestrator containers for v2 architecture");

spawn
  .command("agent")
  .description("Spawn an agent container for an engagement")
  .requiredOption("--image <image>", "Container image: pk-agent-recon, pk-agent-attack, pk-agent-full")
  .option("--target <ip>", "Override primary target IP (default: first in-scope target from DB)")
  .option("--target-hostname <host>", "Add /etc/hosts entry: host -> target IP (repeatable)", (v: string, prev: string[]) => [...prev, v], [] as string[])
  .option("--lhost <ip>", "Override LHOST (default: auto-detect from VPN tun0)")
  .option("--lport <port>", "Override LPORT", "9090")
  .option("--harness <name>", "Harness to start: claude, pi, opencode")
  .option("--model <model>", "Model for the harness")
  .option("--name <name>", "Container name override")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    const eng = await repo.getEngagement(eid) as { slug: string; name: string } | null;
    if (!eng) throw new Error(`No engagement with id ${eid}`);

    const targets = await repo.listTargets(eid) as Array<{ identifier: string; inScope: boolean; notes?: string; kind: string }>;
    const inScope = targets.filter((t) => t.inScope);
    if (inScope.length === 0 && !o.target) throw new Error("No in-scope targets. Add one with: pk target add --kind host --id <ip> --in-scope");

    const primaryTarget = o.target ?? inScope[0].identifier;
    const allTargets = o.target ? [o.target] : inScope.map((t) => t.identifier);
    const containerName = o.name ?? `pk-agent-${eng.slug}-${Math.random().toString(36).slice(2, 8)}`;

    // Auto-detect LHOST from VPN tun0
    let lhost = o.lhost ?? "";
    if (!lhost) {
      const colima = detectColima();
      if (colima.isColima) {
        try {
          const tunOut = colimaExec("ip -4 addr show tun0 2>/dev/null || true");
          const m = tunOut.match(/inet ([\d.]+)/);
          if (m) lhost = m[1];
        } catch {}
      }
      if (!lhost) {
        try {
          const { execFileSync: efs } = await import("node:child_process");
          const tunOut = efs("docker", ["exec", config.attackbox.container, "ip", "-4", "addr", "show", "tun0"],
            { timeout: 5000 }).toString();
          const m = tunOut.match(/inet ([\d.]+)/);
          if (m) lhost = m[1];
        } catch {}
      }
    }

    // Build docker run args
    const dockerArgs = [
      "run", "-d",
      "--name", containerName,
      "--network", "pk-network",
      "-e", `TARGET=${primaryTarget}`,
      "-e", `TARGETS=${allTargets.join(",")}`,
      "-e", `LHOST=${lhost}`,
      "-e", `LPORT=${o.lport}`,
      "-e", `ENGAGEMENT_ID=${eid}`,
      "-e", `ENGAGEMENT_SLUG=${eng.slug}`,
    ];

    if (o.harness) dockerArgs.push("-e", `PK_HARNESS=${o.harness}`);
    if (o.model) dockerArgs.push("-e", `PK_MODEL=${o.model}`);

    // Volumes
    const cwd = process.cwd();
    dockerArgs.push("-v", `${cwd}/engagements/${eng.slug}:/workspace/engagements/${eng.slug}`);
    dockerArgs.push("-v", `${cwd}/.env:/opt/pk/.env:ro`);

    // /etc/hosts entries for target hostnames
    for (const hostname of o.targetHostname) {
      dockerArgs.push("--add-host", `${hostname}:${primaryTarget}`);
    }
    for (const t of inScope) {
      if (t.notes && /^[a-zA-Z0-9.-]+$/.test(t.notes)) {
        dockerArgs.push("--add-host", `${t.notes}:${t.identifier}`);
      }
    }

    dockerArgs.push(o.image);

    console.error(`[spawn] Creating container: ${containerName}`);
    console.error(`[spawn] Image: ${o.image}`);
    console.error(`[spawn] TARGET=${primaryTarget} LHOST=${lhost || "(none)"}`);

    const { execFileSync: efs } = await import("node:child_process");
    try {
      const containerId = efs("docker", dockerArgs, { timeout: 60000 }).toString().trim();
      console.error(`[spawn] Container started: ${containerId.slice(0, 12)}`);

      await repo.startAgentRun({ engagementId: eid, agent: containerName, phase: (eng as { phase?: string }).phase ?? "recon" });

      out({ container: containerName, id: containerId.slice(0, 12), target: primaryTarget, lhost, image: o.image });
    } catch (err) {
      console.error(`[spawn] Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

spawn
  .command("list")
  .description("List running PK agent containers")
  .action(async () => {
    const { execFileSync: efs } = await import("node:child_process");
    try {
      const out = efs("docker", ["ps", "--filter", "name=pk-agent-", "--filter", "name=pk-orchestrator-",
        "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.ID}}"], { timeout: 10000 }).toString();
      if (!out.trim()) { console.log("No running PK containers"); return; }
      console.log("NAME\tIMAGE\tSTATUS\tID");
      console.log(out.trim());
    } catch {
      console.log("No running PK containers");
    }
  });

spawn
  .command("stop")
  .description("Stop and remove a PK agent container")
  .argument("<name>", "Container name")
  .action(async (name: string) => {
    const { execFileSync: efs } = await import("node:child_process");
    try {
      efs("docker", ["stop", name], { timeout: 30000 });
      efs("docker", ["rm", name], { timeout: 10000 });
      console.error(`[spawn] Stopped and removed: ${name}`);
    } catch (err) {
      console.error(`[spawn] Failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    console.error(`pk: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
