#!/usr/bin/env node
/**
 * `pk`: the PromptKiddie engagement CLI. The orchestrator and sub-agents use this to read
 * and write the engagement database. Thin wrapper over @promptkiddie/core.
 */
import "dotenv/config";
import { Command } from "commander";
import {
  addEvidence,
  addFinding,
  addTarget,
  closeDb,
  createEngagement,
  finishAgentRun,
  getEngagement,
  listEngagements,
  listFindings,
  listTargets,
  logActivity,
  pollInbox,
  sendMessage,
  setEngagementStatus,
  startAgentRun,
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

// --- evidence --------------------------------------------------------------
program
  .command("evidence")
  .description("Register an on-disk artifact (hashes + links it)")
  .command("add")
  .requiredOption("--path <path>", "path under engagements/<slug>/")
  .requiredOption("--type <type>", "screenshot | scan | output | file")
  .option("--finding <id>", "link to a finding")
  .option("--engagement <id>")
  .action(async (o) => {
    const eid = await resolveEngagementId(o.engagement);
    out(await addEvidence({ engagementId: eid, path: o.path, type: o.type, findingId: o.finding }));
  });

// --- activity --------------------------------------------------------------
program
  .command("activity")
  .description("Append-only audit trail")
  .command("log")
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
    const engagementId = o.engagement;
    out(await sendMessage({ body: o.body, direction: o.direction, author: o.author, engagementId }));
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
