#!/usr/bin/env node
/**
 * `pk`: the PromptKiddie engagement CLI. The orchestrator and sub-agents use this to read
 * and write the engagement database. Thin wrapper over @promptkiddie/core.
 */
import "dotenv/config";
import { Command } from "commander";
import {
  addEvidence,
  closeDb,
  generateReport,
  getEngagement,
  getRepo,
  loadConfig,
} from "@promptkiddie/core";
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
  .action(async (o) => {
    const row = await repo.createEngagement({ name: o.name, type: o.type, scope: o.scope, brief: o.brief, sourceUrl: o.sourceUrl, group: o.group }) as { id: string };
    await setActiveEngagement(row.id);
    console.error(`Created engagement and set it active: ${row.id}`);
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

// --- vpn (manage VPN in tooling container) ---------------------------------
const vpn = program.command("vpn").description("Manage VPN in the tooling container");

vpn
  .command("up")
  .description("Start OpenVPN in the tooling container")
  .option("--config <path>", "config file path inside container", "/vpn/config.ovpn")
  .action(async (o) => {
    const { execFile: exec } = await import("node:child_process");
    const container = config.attackbox.container;

    const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      exec("docker", ["exec", container, ...args], { timeout: 30000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });

    console.error("[vpn] Starting OpenVPN...");
    await run(["openvpn", "--config", o.config, "--daemon", "--log", "/var/log/openvpn.log"]);

    for (let i = 0; i < 30; i++) {
      try {
        const out = await run(["ip", "-4", "addr", "show", "tun0"]);
        const match = out.match(/inet ([\d.]+)/);
        if (match) {
          console.error(`[vpn] Connected: tun0 = ${match[1]}`);
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.error("[vpn] WARNING: tun0 not up after 30s. Check: docker exec " + container + " cat /var/log/openvpn.log");
  });

vpn
  .command("down")
  .description("Stop OpenVPN in the tooling container")
  .action(async () => {
    const { execFile: exec } = await import("node:child_process");
    const container = config.attackbox.container;
    exec("docker", ["exec", container, "killall", "openvpn"], (err) => {
      if (err) console.error("[vpn] OpenVPN not running or kill failed");
      else console.error("[vpn] Stopped");
    });
  });

vpn
  .command("status")
  .description("Check VPN status in the tooling container")
  .action(async () => {
    const { execFile: exec } = await import("node:child_process");
    const container = config.attackbox.container;
    exec("docker", ["exec", container, "ip", "-4", "addr", "show", "tun0"], (err, stdout) => {
      if (err || !stdout) console.log("VPN: disconnected");
      else {
        const match = stdout.match(/inet ([\d.]+)/);
        console.log(match ? `VPN: connected (${match[1]})` : "VPN: disconnected");
      }
    });
  });

// --- exec (run command + auto-log) -----------------------------------------
const CONTAINER = config.attackbox.container;
const USE_DOCKER = config.attackbox.exec_mode !== "local";

program
  .command("exec")
  .description("Run a command and auto-log it. Uses Docker container by default, --local for host.")
  .option("--phase <phase>", "scoping | recon | enum | exploit | postexploit | report", "recon")
  .option("--agent <name>", "agent name for attribution", "agent")
  .option("--host", "run on the host instead of in the Docker container (for VPN targets)")
  .option("--reason <reason>", "why this command is being run (logged to activity)")
  .option("--max-output <bytes>", "max bytes returned to caller (full output saved to file)", parseInt, 4096)
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
    const reasonSuffix = o.reason ? ` | ${o.reason}` : "";

    await repo.logActivity({
      engagementId: eid,
      phase: o.phase,
      action: `[${o.agent}] ${toolName} (${duration}ms, exit ${result.code})${reasonSuffix}`,
      command: cmdStr,
      actor: "agent",
    });

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
