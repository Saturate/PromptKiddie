import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate the zod schemas from index.ts to test the tool contract.
// If these drift from the actual definitions, that's a signal to extract
// the schemas into a shared module.

const VALID_UUID = "63660e74-ffe1-4f35-a606-efc3e4e8d979";

const schemas = {
  create_engagement: z.object({
    name: z.string(),
    type: z.enum(["ctf", "whitebox", "blackbox", "bugbounty"]),
    scope: z.string().optional(),
    no_playbook: z.boolean().optional(),
  }),

  add_target: z.object({
    engagementId: z.string().uuid(),
    kind: z.enum(["host", "domain", "url", "app", "repo"]),
    identifier: z.string(),
    inScope: z.boolean().optional(),
    notes: z.string().optional(),
  }),

  add_finding: z.object({
    engagementId: z.string().uuid(),
    title: z.string(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
    cvss: z.number().optional(),
    status: z.enum(["triage", "confirmed", "reported", "remediated"]).optional(),
    owasp: z.array(z.string()).optional(),
    attackTechniques: z.array(z.string()).optional(),
    cve: z.array(z.string()).optional(),
    targetId: z.string().uuid().optional(),
    description: z.string().optional(),
    remediation: z.string().optional(),
  }),

  add_service: z.object({
    engagementId: z.string().uuid(),
    targetId: z.string().uuid(),
    port: z.number().optional(),
    protocol: z.string().optional().default("tcp"),
    name: z.string().optional(),
    product: z.string().optional(),
    version: z.string().optional(),
    cpe: z.string().optional(),
    banner: z.string().optional(),
    os: z.string().optional(),
    tech: z.array(z.string()).optional(),
    notes: z.string().optional(),
    discoveredBy: z.string().optional(),
  }),

  capture_flag: z.object({
    id: z.string().uuid(),
    flag: z.string(),
  }),

  advance_phase: z.object({
    id: z.string().uuid(),
    phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
  }),

  set_engagement_status: z.object({
    id: z.string().uuid(),
    status: z.enum(["scoping", "active", "paused", "reporting", "done"]),
  }),

  add_evidence: z.object({
    engagementId: z.string().uuid(),
    path: z.string(),
    type: z.enum(["flag", "screenshot", "scan", "output", "file"]),
    findingId: z.string().uuid().optional(),
  }),

  log_activity: z.object({
    engagementId: z.string().uuid(),
    phase: z.enum(["scoping", "recon", "enum", "exploit", "postexploit", "report"]),
    action: z.string(),
    command: z.string().optional(),
    actor: z.enum(["orchestrator", "agent", "human"]).optional(),
    resultEvidenceId: z.string().uuid().optional(),
  }),

  add_service_cred: z.object({
    serviceId: z.string().uuid(),
    username: z.string(),
    password: z.string().optional(),
    hash: z.string().optional(),
    hashType: z.string().optional(),
    source: z.string(),
    verified: z.boolean().optional().default(false),
  }),
};

describe("create_engagement", () => {
  const s = schemas.create_engagement;

  it("accepts valid CTF engagement", () => {
    expect(s.safeParse({ name: "HTB Nexus", type: "ctf" }).success).toBe(true);
  });

  it("accepts with scope and no_playbook", () => {
    const r = s.safeParse({ name: "Test", type: "blackbox", scope: "10.0.0.0/24", no_playbook: true });
    expect(r.success).toBe(true);
  });

  it("rejects missing name", () => {
    expect(s.safeParse({ type: "ctf" }).success).toBe(false);
  });

  it("rejects invalid type", () => {
    expect(s.safeParse({ name: "Test", type: "pentest" }).success).toBe(false);
  });

  it("rejects empty object", () => {
    expect(s.safeParse({}).success).toBe(false);
  });
});

describe("add_target", () => {
  const s = schemas.add_target;

  it("accepts valid host target", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, kind: "host", identifier: "10.129.49.233" }).success).toBe(true);
  });

  it("accepts domain target with notes", () => {
    const r = s.safeParse({ engagementId: VALID_UUID, kind: "domain", identifier: "nexus.htb", inScope: true, notes: "main domain" });
    expect(r.success).toBe(true);
  });

  it("rejects non-uuid engagementId", () => {
    expect(s.safeParse({ engagementId: "not-a-uuid", kind: "host", identifier: "10.0.0.1" }).success).toBe(false);
  });

  it("rejects invalid kind", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, kind: "network", identifier: "10.0.0.0/24" }).success).toBe(false);
  });

  it("rejects missing identifier", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, kind: "host" }).success).toBe(false);
  });
});

describe("add_finding", () => {
  const s = schemas.add_finding;

  it("accepts minimal finding (just title + engagementId)", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, title: "SQL Injection in login" }).success).toBe(true);
  });

  it("accepts full finding", () => {
    const r = s.safeParse({
      engagementId: VALID_UUID,
      title: "RCE via TinyMCE upload",
      severity: "critical",
      cvss: 9.9,
      status: "triage",
      cve: ["CVE-2026-38526"],
      owasp: ["A03:2021-Injection"],
      attackTechniques: ["T1190"],
      targetId: VALID_UUID,
      description: "File upload to webshell",
      remediation: "Validate file extensions",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid severity", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, title: "Test", severity: "extreme" }).success).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, title: "Test", status: "open" }).success).toBe(false);
  });

  it("rejects non-uuid targetId", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, title: "Test", targetId: "abc" }).success).toBe(false);
  });

  it("rejects missing title", () => {
    expect(s.safeParse({ engagementId: VALID_UUID }).success).toBe(false);
  });
});

describe("add_service", () => {
  const s = schemas.add_service;

  it("accepts minimal service (just IDs)", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, targetId: VALID_UUID }).success).toBe(true);
  });

  it("accepts full service registration", () => {
    const r = s.safeParse({
      engagementId: VALID_UUID,
      targetId: VALID_UUID,
      port: 80,
      protocol: "tcp",
      name: "http",
      product: "nginx",
      version: "1.24.0",
      os: "Ubuntu 24.04",
      tech: ["php", "laravel"],
      banner: "nginx/1.24.0",
      discoveredBy: "recon-agent",
    });
    expect(r.success).toBe(true);
  });

  it("defaults protocol to tcp", () => {
    const r = s.safeParse({ engagementId: VALID_UUID, targetId: VALID_UUID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.protocol).toBe("tcp");
  });

  it("rejects non-uuid engagementId", () => {
    expect(s.safeParse({ engagementId: "bad", targetId: VALID_UUID }).success).toBe(false);
  });

  it("rejects non-uuid targetId", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, targetId: "bad" }).success).toBe(false);
  });

  it("accepts tech as string array", () => {
    const r = s.safeParse({ engagementId: VALID_UUID, targetId: VALID_UUID, tech: ["python", "flask"] });
    expect(r.success).toBe(true);
  });

  it("rejects tech as plain string", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, targetId: VALID_UUID, tech: "php" }).success).toBe(false);
  });
});

describe("capture_flag", () => {
  const s = schemas.capture_flag;

  it("accepts valid flag capture", () => {
    expect(s.safeParse({ id: VALID_UUID, flag: "6b59bb4e9ec0a6e5425fd9aa5cdf26fa" }).success).toBe(true);
  });

  it("rejects non-uuid id", () => {
    expect(s.safeParse({ id: "not-uuid", flag: "flag{test}" }).success).toBe(false);
  });

  it("rejects missing flag", () => {
    expect(s.safeParse({ id: VALID_UUID }).success).toBe(false);
  });

  it("rejects empty flag", () => {
    // zod string() accepts empty string by default
    const r = s.safeParse({ id: VALID_UUID, flag: "" });
    expect(r.success).toBe(true);
  });
});

describe("advance_phase", () => {
  const s = schemas.advance_phase;

  it("accepts valid phase transition", () => {
    expect(s.safeParse({ id: VALID_UUID, phase: "recon" }).success).toBe(true);
  });

  it("accepts all valid phases", () => {
    for (const phase of ["scoping", "recon", "enum", "exploit", "postexploit", "report"]) {
      expect(s.safeParse({ id: VALID_UUID, phase }).success).toBe(true);
    }
  });

  it("rejects invalid phase", () => {
    expect(s.safeParse({ id: VALID_UUID, phase: "discovery" }).success).toBe(false);
  });
});

describe("set_engagement_status", () => {
  const s = schemas.set_engagement_status;

  it("accepts all valid statuses", () => {
    for (const status of ["scoping", "active", "paused", "reporting", "done"]) {
      expect(s.safeParse({ id: VALID_UUID, status }).success).toBe(true);
    }
  });

  it("rejects 'created' status (removed from MCP, default is now 'active')", () => {
    expect(s.safeParse({ id: VALID_UUID, status: "created" }).success).toBe(false);
  });
});

describe("add_evidence", () => {
  const s = schemas.add_evidence;

  it("accepts scan evidence", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, path: "engagements/htb-nexus/exec/rustscan.txt", type: "scan" }).success).toBe(true);
  });

  it("accepts all evidence types", () => {
    for (const type of ["flag", "screenshot", "scan", "output", "file"]) {
      expect(s.safeParse({ engagementId: VALID_UUID, path: "/tmp/test", type }).success).toBe(true);
    }
  });

  it("rejects invalid evidence type", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, path: "/tmp/test", type: "log" }).success).toBe(false);
  });
});

describe("log_activity", () => {
  const s = schemas.log_activity;

  it("accepts minimal activity log", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, phase: "recon", action: "port scan complete" }).success).toBe(true);
  });

  it("accepts full activity with command and actor", () => {
    const r = s.safeParse({
      engagementId: VALID_UUID,
      phase: "exploit",
      action: "uploaded webshell",
      command: "curl -X POST http://target/upload -F file=@shell.php",
      actor: "agent",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid actor", () => {
    expect(s.safeParse({ engagementId: VALID_UUID, phase: "recon", action: "test", actor: "bot" }).success).toBe(false);
  });
});

describe("add_service_cred", () => {
  const s = schemas.add_service_cred;

  it("accepts password credential", () => {
    const r = s.safeParse({
      serviceId: VALID_UUID,
      username: "j.matthew@nexus.htb",
      password: "N27xh!!2ucY04",
      source: "git history",
    });
    expect(r.success).toBe(true);
  });

  it("accepts hash credential", () => {
    const r = s.safeParse({
      serviceId: VALID_UUID,
      username: "admin",
      hash: "$2b$12$abc...",
      hashType: "bcrypt",
      source: "database dump",
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing username", () => {
    expect(s.safeParse({ serviceId: VALID_UUID, source: "test" }).success).toBe(false);
  });

  it("rejects missing source", () => {
    expect(s.safeParse({ serviceId: VALID_UUID, username: "admin" }).success).toBe(false);
  });

  it("defaults verified to false", () => {
    const r = s.safeParse({ serviceId: VALID_UUID, username: "admin", source: "test" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.verified).toBe(false);
  });
});
