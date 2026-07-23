// Tests run sequentially: phase advancement builds on state from earlier tests.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

import { loadConfig } from "@promptkiddie/core";
const pkConfig = loadConfig();
const skipDb = !process.env.DATABASE_URL || !pkConfig.api.url;

import {
  CTF_ACTIONS,
  createEngagement,
  deleteEngagement,
  addTarget,
  getEngagement,
  advancePhase,
  closeDb,
} from "@promptkiddie/core";
import { startSupervisor } from "../index.js";

let engagementId: string;
let phaseEngagementId: string;
let supervisor: Awaited<ReturnType<typeof startSupervisor>> | null = null;
let phaseSupervisor: Awaited<ReturnType<typeof startSupervisor>> | null = null;

const actionsStarted: string[] = [];

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timed out");
}

beforeAll(async () => {
  if (skipDb) return;

  const eng = await createEngagement({ name: "cascade-test", type: "ctf" });
  engagementId = eng.id;
  await addTarget({ engagementId, kind: "host", identifier: "10.99.99.99", inScope: true });

  process.env.PK_WS_PORT = "0";
  supervisor = await startSupervisor({
    engagementId,
    playbook: CTF_ACTIONS,
    mode: "standard",
    maxConcurrent: 10,
    onActionStart: (name) => actionsStarted.push(name),
  });

  const phaseEng = await createEngagement({ name: "phase-test", type: "ctf" });
  phaseEngagementId = phaseEng.id;
  await addTarget({ engagementId: phaseEngagementId, kind: "host", identifier: "10.99.99.98", inScope: true });
  await advancePhase(phaseEngagementId, "recon");

  const triggerOnlyPlaybook = {
    name: "phase-test",
    description: "Trigger-only playbook for phase advancement tests",
    actions: CTF_ACTIONS.actions.map((a) => ({ ...a, run: undefined, prompt: undefined })),
  };

  phaseSupervisor = await startSupervisor({
    engagementId: phaseEngagementId,
    playbook: triggerOnlyPlaybook,
    mode: "standard",
    maxConcurrent: 10,
  });
}, 15000);

afterAll(async () => {
  if (supervisor) await supervisor.cleanup().catch(() => {});
  if (phaseSupervisor) await phaseSupervisor.cleanup().catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  if (engagementId) await deleteEngagement(engagementId).catch(() => {});
  if (phaseEngagementId) await deleteEngagement(phaseEngagementId).catch(() => {});
  await closeDb();
}, 15000);

describe.skipIf(skipDb)("Supervisor event cascade", () => {
  it("EngagementStarted triggers port_scan and udp_scan", async () => {
    await waitFor(async () =>
      actionsStarted.includes("port_scan") && actionsStarted.includes("udp_scan"),
    );

    expect(actionsStarted).toContain("port_scan");
    expect(actionsStarted).toContain("udp_scan");
  });

  it("PortDiscovered with service=http triggers web_recon, dir_brute, nuclei_scan", async () => {
    actionsStarted.length = 0;
    expect(supervisor).toBeDefined();

    supervisor?.dispatch({
      type: "PortDiscovered",
      payload: { port: 80, service: "http", state: "open" },
    });

    await waitFor(async () =>
      actionsStarted.includes("web_recon") && actionsStarted.includes("dir_brute"),
    );

    expect(actionsStarted).toContain("web_recon");
    expect(actionsStarted).toContain("dir_brute");
    expect(actionsStarted).toContain("nuclei_scan");
  });

  it("VersionIdentified with product+version triggers cve_search", async () => {
    actionsStarted.length = 0;
    expect(supervisor).toBeDefined();

    supervisor?.dispatch({
      type: "VersionIdentified",
      payload: { product: "nginx", version: "1.24.0", port: 80 },
    });

    await waitFor(async () => actionsStarted.includes("cve_search"));

    expect(actionsStarted).toContain("cve_search");
  });

  it("PortDiscovered with service=ssh does NOT trigger web_recon", async () => {
    actionsStarted.length = 0;
    expect(supervisor).toBeDefined();

    supervisor?.dispatch({
      type: "PortDiscovered",
      payload: { port: 22, service: "ssh", state: "open" },
    });

    await new Promise((r) => setTimeout(r, 300));

    expect(actionsStarted).not.toContain("web_recon");
    expect(actionsStarted).not.toContain("dir_brute");
  });
});

describe.skipIf(skipDb)("Phase advancement", () => {
  it("PortDiscovered advances recon -> enum", async () => {
    expect(phaseSupervisor).toBeDefined();

    phaseSupervisor?.dispatch({
      type: "PortDiscovered",
      payload: { port: 443, service: "https" },
    });

    await waitFor(async () => {
      const eng = await getEngagement(phaseEngagementId);
      return eng?.phase === "enum";
    });

    const eng = await getEngagement(phaseEngagementId);
    expect(eng?.phase).toBe("enum");
  });

  it("FindingAdded advances enum -> exploit", async () => {
    phaseSupervisor?.dispatch({
      type: "FindingAdded",
      payload: { severity: "high", title: "test vuln" },
    });

    await waitFor(async () => {
      const eng = await getEngagement(phaseEngagementId);
      return eng?.phase === "exploit";
    });

    const eng = await getEngagement(phaseEngagementId);
    expect(eng?.phase).toBe("exploit");
  });

  it("ShellObtained advances exploit -> postexploit", async () => {
    phaseSupervisor?.dispatch({
      type: "ShellObtained",
      payload: { user: "www-data", host: "10.99.99.98" },
    });

    await waitFor(async () => {
      const eng = await getEngagement(phaseEngagementId);
      return eng?.phase === "postexploit";
    });

    const eng = await getEngagement(phaseEngagementId);
    expect(eng?.phase).toBe("postexploit");
  });

  it("FlagCaptured with type=root advances -> report", async () => {
    phaseSupervisor?.dispatch({
      type: "FlagCaptured",
      payload: { type: "root", flag: "test{root_flag}" },
    });

    await waitFor(async () => {
      const eng = await getEngagement(phaseEngagementId);
      return eng?.phase === "report";
    });

    const eng = await getEngagement(phaseEngagementId);
    expect(eng?.phase).toBe("report");
  });
});
