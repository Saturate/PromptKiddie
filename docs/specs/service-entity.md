# Service Entity

Structured data model for services discovered during engagements. Replaces ad-hoc
version logging, port notes, and credential scattering with a single entity that
accumulates data throughout the engagement lifecycle.

## Problem

Today PK has targets (hosts/IPs) and ports (open/closed/filtered), but no entity for
"nginx 1.24.0 on port 80 serving OpenSTAManager 2.9.8". Version info gets stuffed into
event payloads, port notes, or discovery summaries where it's hard to query, link to
findings, or feed into CVE searches.

The Enigma engagement showed the cost: OpenSTAManager 2.9.8 and OliveTin v3000.10.0
were both discovered but never CVE-searched because the version data wasn't structured.
A `pk version` command was added as a stopgap, but it's a verb pretending to be a noun.
The real fix is a service entity.

## Data Model

```
Target (host/IP)
  └── Service
        ├── port: 80
        ├── protocol: tcp
        ├── name: http
        ├── product: nginx
        ├── version: 1.24.0
        ├── tech: [php, OpenSTAManager]
        ├── os: Ubuntu
        ├── cpe: cpe:/a:nginx:nginx:1.24.0
        ├── banner: "nginx/1.24.0 (Ubuntu)"
        ├── notes: free text
        ├── creds: [{user, pass, source, verified}]
        ├── cves: [{id, cvss, status, pocUrl}]
        ├── apps: [{name, version, path, tech}]  # sub-applications on this service
        └── meta: {} (json, extensible)
```

A service belongs to a target and optionally to a port. Multiple services can share a
port (e.g. nginx reverse-proxying to OpenSTAManager on port 80). The `apps` array
handles the common case of a web server hosting multiple applications.

### Schema (Drizzle)

```typescript
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  portId: uuid("port_id").references(() => ports.id),
  port: integer("port"),
  protocol: text("protocol").default("tcp"),
  name: text("name"),                              // http, ssh, imap, nfs, smb
  product: text("product"),                         // nginx, OpenSSH, Dovecot
  version: text("version"),                         // 1.24.0, 9.6p1
  cpe: text("cpe"),                                 // cpe:/a:vendor:product:version
  banner: text("banner"),                           // raw banner text
  os: text("os"),                                   // OS hint from this service
  tech: jsonb("tech").$type<string[]>().default([]),         // php, python, java, etc.
  apps: jsonb("apps").$type<ServiceApp[]>().default([]),     // sub-applications
  creds: jsonb("creds").$type<ServiceCred[]>().default([]),  // linked credentials
  cves: jsonb("cves").$type<ServiceCve[]>().default([]),     // known CVEs
  notes: text("notes"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  discoveredBy: text("discovered_by"),              // action or agent that found it
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

interface ServiceApp {
  name: string;           // OpenSTAManager, Roundcube, OliveTin
  version?: string;
  path?: string;          // /openstamanager, /roundcube
  tech?: string[];        // php, python
}

interface ServiceCred {
  username: string;
  password?: string;
  hash?: string;
  hashType?: string;      // bcrypt, ntlm, sha1
  source: string;         // "NFS PDF", "config.inc.php", "cracked from DB"
  verified: boolean;
}

interface ServiceCve {
  id: string;             // CVE-2025-69212
  cvss?: number;
  severity?: string;
  status: "suspected" | "confirmed" | "not_vulnerable";
  pocUrl?: string;
  notes?: string;
}
```

## CLI

```bash
# Add a service (auto-emits VersionIdentified, auto-searches CVEs)
pk service add --target <id> --port 80 --name http --product nginx --version 1.24.0
pk service add --target <id> --port 80 --product OpenSTAManager --version 2.9.8 --tech php
pk service add --target <id> --port 1337 --product OliveTin --version 3000.10.0

# Update (version change re-triggers CVE search)
pk service update <id> --version 2.9.9
pk service update <id> --tech php,mysql --notes "config at /var/www/html/config.inc.php"

# Add sub-application to existing service
pk service app <id> --name Roundcube --version 1.6.16 --path /roundcube --tech php

# Attach credentials
pk service cred <id> --user admin --pass Ne3s4rtars78s --source "email from it@enigma.htb"
pk service cred <id> --user haris --hash '$2y$10$WHf...' --hash-type bcrypt --source "zz_users table"
pk service cred <id> --user haris --pass bestfriends --source "cracked from bcrypt"

# Link a CVE
pk service cve <id> --cve CVE-2025-69212 --cvss 9.8 --status confirmed --poc-url https://...

# Read
pk service list                          # all services for active engagement
pk service list --target <id>            # services on a target
pk service show <id>                     # full detail: versions, creds, CVEs, apps
pk service creds                         # all creds across all services (credential dump)
```

## MCP Tools

```
add_service        - create a service entry
update_service     - update version, tech, notes
add_service_app    - add sub-application to service
add_service_cred   - attach credentials
add_service_cve    - link a CVE
list_services      - list services for engagement/target
get_service        - full service detail
list_all_creds     - credential dump across all services
```

## Automatic Behaviors

### On service add/update with version

1. Emit `VersionIdentified` event (triggers supervisor's `cve_search` action)
2. Log as discovery: `"nginx 1.24.0 on port 80"`
3. Search local exploit index
4. Run searchsploit (if attackbox available)
5. Auto-link any CVE hits as `suspected` entries on the service

### On credential add

1. Log as artifact (type: credential)
2. If `verified: false` and service has an auth endpoint, queue a credential validation task

### On CVE status change to confirmed

1. Create or update a finding linked to this service
2. Log activity

## Replaces

| Current | Replaced by |
|---------|------------|
| `pk version --product X --version Y` | `pk service add --product X --version Y` |
| `pk artifact add --type credential` | `pk service cred <id> --user X --pass Y` |
| `pk finding add` for version-specific CVEs | Auto-created when `pk service cve <id> --status confirmed` |
| `pk port add` (partially) | `pk service add` creates the port if needed |
| Version data in PortDiscovered payloads | First-class field on the service entity |
| Discovery entries for versions | Auto-generated from service data |

## Migration

The `pk version` command (stopgap from this session) becomes an alias for
`pk service add`. The `log_version` MCP tool becomes an alias for `add_service`.
Both continue to work but emit deprecation notices.

Existing `ports` table remains; services reference ports but don't replace them.
The ports table tracks open/closed/filtered state; services track what runs on them.

## Relationship to Findings

Services link to findings bidirectionally:

- `pk service cve <svc> --cve CVE-2025-69212 --status confirmed` auto-creates a finding
- `pk finding add --service <svc>` links a finding to a service
- `pk service show <id>` displays linked findings

This replaces the current pattern where findings float free and the connection between
"OpenSTAManager 2.9.8 is vulnerable to CVE-2025-69212" and "we exploited it" is only
in the activity log prose.

## Portability

The service entity is DB-backed and exposed via both CLI and MCP. Any harness (Claude
Code, Codex, OpenCode, Pi) can interact with it. The AGENT.md instruction becomes:

> When you identify a service with a version, call `pk service add` (CLI) or
> `add_service` (MCP tool). Everything else happens automatically.

No harness-specific configuration needed.
