#!/usr/bin/env node
/**
 * `pk`: the PromptKiddie engagement CLI. The orchestrator and sub-agents use this to read
 * and write the engagement database. Thin wrapper over @promptkiddie/core.
 */
import "dotenv/config";
import { Command } from "commander";
import {
  addAgentLog,
  addEvidence,
  addFinding,
  addTarget,
  advancePhase,
  closeDb,
  createEngagement,
  deleteEngagement,
  finishAgentRun,
  getEngagement,
  getPhase,
  listActivity,
  listEngagements,
  listMessages,
  listEvidence,
  listFindings,
  listTargets,
  logActivity,
  pollInbox,
  sendMessage,
  setEngagementStatus,
  startAgentRun,
  updateFinding,
  updateTarget,
} from "@promptkiddie/core";
import { resolveEngagementId, setActiveEngagement } from "./state.js";

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
  .action(async (o) => {
    const row = await createEngagement({ name: o.name, type: o.type, scope: o.scope });
    await setActiveEngagement(row.id);
    console.error(`Created engagement and set it active: ${row.id}`);
    out(row);
  });

engagement
  .command("list")
  .action(async () => out(await listEngagements()));

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
    const eng = await getEngagement(eid);
    if (!eng) throw new Error(`No engagement with id ${eid}`);
    out({ engagement: eng, targets: await listTargets(eid), findings: await listFindings(eid) });
  });

engagement
  .command("status")
  .argument("<status>", "scoping | active | paused | reporting | done")
  .option("--engagement <id>")
  .action(async (status, o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await setEngagementStatus(eid, status));
  });

engagement
  .command("delete")
  .argument("<id>")
  .action(async (id: string) => {
    const row = await deleteEngagement(id);
    if (!row) throw new Error(`No engagement with id ${id}`);
    console.error(`Deleted engagement: ${row.name} (${id})`);
    out(row);
  });

engagement
  .command("phase")
  .argument("[target-phase]", "scoping | recon | enum | exploit | postexploit | report")
  .option("--engagement <id>")
  .action(async (targetPhase: string | undefined, o) => {
    const eid = await resolveEngagementId(o.engagement);
    if (!targetPhase) {
      out(await getPhase(eid));
      return;
    }
    const result = await advancePhase(eid, targetPhase as Parameters<typeof advancePhase>[1]);
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
      await addTarget({
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
  .action(async (o) => out(await listTargets(await resolveEngagementId(o.engagement))));

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
    out(await updateTarget(id, updates));
  });

// --- finding ---------------------------------------------------------------
const finding = program.command("finding").description("Manage findings");

finding
  .command("add")
  .requiredOption("--title <title>")
  .option("--severity <severity>", "critical | high | medium | low | info", "info")
  .option("--cvss <score>", "CVSS v3.1 base score", parseFloat)
  .option("--status <status>", "triage | confirmed | reported | remediated", "triage")
  .option("--owasp <refs>", "comma-separated OWASP refs, e.g. A03:2021")
  .option("--attack <ids>", "comma-separated ATT&CK ids, e.g. T1190")
  .option("--cve <ids>", "comma-separated CVE ids")
  .option("--target <id>", "affected target id")
  .option("--desc <description>")
  .option("--remediation <text>")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(
      await addFinding({
        engagementId: eid,
        title: o.title,
        severity: o.severity,
        cvss: o.cvss,
        status: o.status,
        owasp: list(o.owasp),
        attackTechniques: list(o.attack),
        cve: list(o.cve),
        targetId: o.target,
        description: o.desc,
        remediation: o.remediation,
      }),
    );
  });

finding
  .command("list")
  .option("--engagement <id>")
  .action(async (o) => out(await listFindings(await resolveEngagementId(o.engagement))));

finding
  .command("update")
  .argument("<id>")
  .option("--title <title>")
  .option("--severity <severity>", "critical | high | medium | low | info")
  .option("--cvss <score>", "CVSS v3.1 base score", parseFloat)
  .option("--status <status>", "triage | confirmed | reported | remediated")
  .option("--owasp <refs>", "comma-separated OWASP refs")
  .option("--attack <ids>", "comma-separated ATT&CK ids")
  .option("--cve <ids>", "comma-separated CVE ids")
  .option("--target <id>", "affected target id")
  .option("--desc <description>")
  .option("--remediation <text>")
  .action(async (id: string, o) => {
    const updates: Record<string, unknown> = {};
    if (o.title !== undefined) updates.title = o.title;
    if (o.severity !== undefined) updates.severity = o.severity;
    if (o.cvss !== undefined) updates.cvss = o.cvss;
    if (o.status !== undefined) updates.status = o.status;
    if (o.owasp !== undefined) updates.owasp = list(o.owasp);
    if (o.attack !== undefined) updates.attackTechniques = list(o.attack);
    if (o.cve !== undefined) updates.cve = list(o.cve);
    if (o.target !== undefined) updates.targetId = o.target;
    if (o.desc !== undefined) updates.description = o.desc;
    if (o.remediation !== undefined) updates.remediation = o.remediation;
    out(await updateFinding(id, updates));
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
  .action(async (o) => out(await listEvidence(await resolveEngagementId(o.engagement))));

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
      await logActivity({
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
  .action(async (o) => out(await listActivity(await resolveEngagementId(o.engagement))));

// --- agent run bookkeeping -------------------------------------------------
const agent = program.command("agent").description("Sub-agent run bookkeeping");

agent
  .command("start")
  .requiredOption("--agent <name>")
  .requiredOption("--phase <phase>")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await startAgentRun({ engagementId: eid, agent: o.agent, phase: o.phase }));
  });

agent
  .command("finish")
  .argument("<runId>")
  .requiredOption("--status <status>", "ok | failed")
  .option("--summary <text>")
  .action(async (runId, o) =>
    out(await finishAgentRun({ runId, status: o.status, summary: o.summary })),
  );

// --- inbox (msg) -----------------------------------------------------------
const msg = program.command("msg").description("Human<->orchestrator message inbox");

msg
  .command("list")
  .description("List all messages for an engagement")
  .option("--engagement <id>")
  .action(async (o) => out(await listMessages(await resolveEngagementId(o.engagement))));

msg
  .command("poll")
  .description("Fetch new inbound messages and mark them read")
  .option("--engagement <id>")
  .action(async (o) => {
    // Inbox messages may be engagement-scoped or global; only filter if asked.
    out(await pollInbox(o.engagement));
  });

msg
  .command("send")
  .requiredOption("--body <body>")
  .option("--direction <direction>", "inbound | outbound", "outbound")
  .option("--author <author>")
  .option("--engagement <id>")
  .action(async (o) => {
    const engagementId = await resolveEngagementId(o.engagement);
    out(await sendMessage({ body: o.body, direction: o.direction, author: o.author, engagementId }));
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
    out(await addAgentLog({
      engagementId: eid,
      agent: o.agent,
      phase: o.phase,
      message,
      category: o.category,
    }));
  });

// --- exec (run command + auto-log) -----------------------------------------
const CONTAINER = process.env.PK_TOOLING_CONTAINER ?? "promptkiddie-tooling";
const USE_DOCKER = process.env.PK_EXEC_MODE !== "local";

program
  .command("exec")
  .description("Run a command and auto-log it. Uses Docker container by default, --local for host.")
  .option("--phase <phase>", "scoping | recon | enum | exploit | postexploit | report", "recon")
  .option("--agent <name>", "agent name for attribution", "agent")
  .option("--host", "run on the host instead of in the Docker container (for VPN targets)")
  .option("--engagement <id>")
  .argument("<command...>", "command to run")
  .action(async (cmd: string[], o) => {
    const eid = await resolveEngagementId(o.engagement);
    const cmdStr = cmd.join(" ");
    const start = Date.now();
    const local = o.host || !USE_DOCKER;

    const { execFile: exec } = await import("node:child_process");
    const execArgs: [string, string[]] = local
      ? ["sh", ["-c", cmdStr]]
      : ["docker", ["exec", CONTAINER, "sh", "-c", cmdStr]];

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

    await logActivity({
      engagementId: eid,
      phase: o.phase,
      action: `[${o.agent}] ${toolName} (${duration}ms, exit ${result.code})`,
      command: cmdStr,
      actor: "agent",
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.code;
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
