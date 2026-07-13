// Tests run sequentially: each describe block builds on state from earlier blocks.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

const skipDb = !process.env.DATABASE_URL;

import {
  createEngagement,
  deleteEngagement,
  addTarget,
  addService,
  updateService,
  addServiceApp,
  addServiceCred,
  addServiceCve,
  listServices,
  getService,
  listAllCreds,
  listEvents,
  listFindings,
  listArtifacts,
  buildLlmContext,
} from "../index.js";
import { closeDb } from "../db.js";

let engagementId: string;
let targetId: string;

function findNginx(svcs: Awaited<ReturnType<typeof listServices>>) {
  const svc = svcs.find((s) => s.product === "nginx");
  expect(svc, "nginx service should exist").toBeDefined();
  return svc!;
}

beforeAll(async () => {
  if (skipDb) return;
  const eng = await createEngagement({ name: "service-entity-test", type: "ctf" });
  engagementId = eng.id;
  const tgt = await addTarget({
    engagementId,
    kind: "host",
    identifier: "10.0.0.99",
    inScope: true,
  });
  targetId = tgt.id;
});

afterAll(async () => {
  if (skipDb) return;
  await deleteEngagement(engagementId);
  await closeDb();
});

describe.skipIf(skipDb)("addService", () => {
  it("inserts a new service and emits VersionIdentified", async () => {
    const svc = await addService({
      engagementId,
      targetId,
      port: 80,
      protocol: "tcp",
      name: "http",
      product: "nginx",
      version: "1.24.0",
    });

    expect(svc.id).toBeDefined();
    expect(svc.product).toBe("nginx");
    expect(svc.version).toBe("1.24.0");
    expect(svc.port).toBe(80);

    const events = await listEvents(engagementId, { type: "VersionIdentified" });
    const match = events.find(
      (e) => e.payload && typeof e.payload === "object" && "product" in e.payload && e.payload.product === "nginx",
    );
    expect(match).toBeDefined();
  });

  it("upserts on same key (no duplicate row)", async () => {
    const svc = await addService({
      engagementId,
      targetId,
      port: 80,
      protocol: "tcp",
      product: "nginx",
      version: "1.25.0",
    });

    const all = await listServices(engagementId);
    const nginxServices = all.filter(
      (s) => s.product === "nginx" && s.port === 80,
    );
    expect(nginxServices).toHaveLength(1);
    expect(nginxServices[0].version).toBe("1.25.0");
    expect(nginxServices[0].id).toBe(svc.id);
  });

  it("does NOT emit VersionIdentified on re-submission of same data", async () => {
    const eventsBefore = await listEvents(engagementId, { type: "VersionIdentified" });
    const countBefore = eventsBefore.length;

    await addService({
      engagementId,
      targetId,
      port: 80,
      protocol: "tcp",
      product: "nginx",
      version: "1.25.0",
    });

    const eventsAfter = await listEvents(engagementId, { type: "VersionIdentified" });
    expect(eventsAfter.length).toBe(countBefore);
  });

  it("does not overwrite existing fields with undefined", async () => {
    await addService({
      engagementId,
      targetId,
      port: 80,
      protocol: "tcp",
      product: "nginx",
    });

    const all = await listServices(engagementId);
    const svc = all.find((s) => s.product === "nginx" && s.port === 80);
    expect(svc, "nginx service should exist").toBeDefined();
    expect(svc?.version).toBe("1.25.0");
  });
});

describe.skipIf(skipDb)("updateService", () => {
  it("re-emits VersionIdentified when version changes", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    const eventsBefore = await listEvents(engagementId, { type: "VersionIdentified" });
    const countBefore = eventsBefore.length;

    await updateService(svc.id, { version: "1.26.0" });

    const eventsAfter = await listEvents(engagementId, { type: "VersionIdentified" });
    expect(eventsAfter.length).toBe(countBefore + 1);
  });
});

describe.skipIf(skipDb)("addServiceApp", () => {
  it("appends an app to the service", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    await addServiceApp(svc.id, {
      name: "Roundcube",
      version: "1.6.16",
      path: "/roundcube",
      tech: ["php"],
    });

    const updated = await getService(svc.id);
    expect(updated, "service should exist").not.toBeNull();
    expect(updated?.apps?.some((a) => a.name === "Roundcube")).toBe(true);
  });

  it("deduplicates by name+path", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    await addServiceApp(svc.id, {
      name: "Roundcube",
      version: "1.6.17",
      path: "/roundcube",
    });

    const updated = await getService(svc.id);
    expect(updated).not.toBeNull();
    const roundcubes = updated?.apps?.filter((a) => a.name === "Roundcube") ?? [];
    expect(roundcubes).toHaveLength(1);
  });
});

describe.skipIf(skipDb)("addServiceCred", () => {
  it("appends a credential and creates an artifact", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    await addServiceCred(svc.id, {
      username: "admin",
      password: "secret123",
      source: "config file",
      verified: false,
    });

    const updated = await getService(svc.id);
    expect(updated).not.toBeNull();
    expect(updated?.creds?.some((c) => c.username === "admin")).toBe(true);

    const arts = await listArtifacts(engagementId);
    const credArt = arts.find((a) => a.type === "credential" && a.content?.includes("admin"));
    expect(credArt).toBeDefined();
  });

  it("deduplicates by username+source", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    await addServiceCred(svc.id, {
      username: "admin",
      password: "changed",
      source: "config file",
      verified: true,
    });

    const updated = await getService(svc.id);
    expect(updated).not.toBeNull();
    const admins = updated?.creds?.filter((c) => c.username === "admin") ?? [];
    expect(admins).toHaveLength(1);
  });
});

describe.skipIf(skipDb)("addServiceCve", () => {
  it("appends a CVE and auto-creates finding when confirmed", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    await addServiceCve(svc.id, {
      id: "CVE-2099-0001",
      cvss: 9.8,
      severity: "critical",
      status: "confirmed",
      notes: "test CVE",
    });

    const updated = await getService(svc.id);
    expect(updated).not.toBeNull();
    expect(updated?.cves?.some((c) => c.id === "CVE-2099-0001")).toBe(true);

    const fds = await listFindings(engagementId);
    const match = fds.find((f) => f.cve?.includes("CVE-2099-0001"));
    expect(match, "finding should be auto-created for confirmed CVE").toBeDefined();
    expect(match?.status).toBe("confirmed");
    expect(match?.serviceId).toBe(svc.id);
  });

  it("does NOT create finding for suspected status", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);
    const findingsBefore = await listFindings(engagementId);

    await addServiceCve(svc.id, {
      id: "CVE-2099-0002",
      status: "suspected",
    });

    const findingsAfter = await listFindings(engagementId);
    expect(findingsAfter.length).toBe(findingsBefore.length);
  });

  it("deduplicates by CVE id", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    await addServiceCve(svc.id, {
      id: "CVE-2099-0001",
      cvss: 10.0,
      status: "confirmed",
    });

    const updated = await getService(svc.id);
    expect(updated).not.toBeNull();
    const matches = updated?.cves?.filter((c) => c.id === "CVE-2099-0001") ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe.skipIf(skipDb)("listServices", () => {
  it("filters by targetId", async () => {
    const tgt2 = await addTarget({
      engagementId,
      kind: "host",
      identifier: "10.0.0.100",
      inScope: true,
    });

    await addService({
      engagementId,
      targetId: tgt2.id,
      port: 22,
      product: "OpenSSH",
      version: "9.6p1",
    });

    const filtered = await listServices(engagementId, { targetId });
    expect(filtered.every((s) => s.targetId === targetId)).toBe(true);

    const all = await listServices(engagementId);
    expect(all.length).toBeGreaterThan(filtered.length);
  });
});

describe.skipIf(skipDb)("getService", () => {
  it("includes linked findings", async () => {
    const all = await listServices(engagementId);
    const svc = findNginx(all);

    const detail = await getService(svc.id);
    expect(detail).not.toBeNull();
    expect(detail?.findings.length).toBeGreaterThan(0);
    expect(detail?.findings[0].cve).toContain("CVE-2099-0001");
  });
});

describe.skipIf(skipDb)("listAllCreds", () => {
  it("aggregates creds across services", async () => {
    const creds = await listAllCreds(engagementId);
    expect(creds.length).toBeGreaterThan(0);
    expect(creds[0]).toHaveProperty("username");
    expect(creds[0]).toHaveProperty("port");
    expect(creds[0]).toHaveProperty("product");
  });
});

describe.skipIf(skipDb)("buildLlmContext", () => {
  it("includes services with apps, cred_count, cves", async () => {
    const ctx = await buildLlmContext(engagementId);
    expect(ctx.services.length).toBeGreaterThan(0);

    const nginx = ctx.services.find((s) => s.product === "nginx");
    expect(nginx, "nginx should be in context").toBeDefined();
    if (!nginx) return;
    expect(nginx.apps.length).toBeGreaterThan(0);
    expect(nginx.cred_count).toBeGreaterThan(0);
    expect(nginx.cves.length).toBeGreaterThan(0);
    expect(nginx.cves[0]).toHaveProperty("id");
    expect(nginx.cves[0]).toHaveProperty("status");
  });
});
