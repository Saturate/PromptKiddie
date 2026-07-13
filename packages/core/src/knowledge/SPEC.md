# ownknowledge spec v0.1

A security-domain profile on top of [OKF](https://cloud.google.com/open-knowledge-format)
for offensive security knowledge. Defines two document types (exploits and techniques),
their schemas, naming conventions, and body structure.

Designed for LLM retrieval: flat directories, descriptive filenames, searchable frontmatter.

## Directory layout

```
exploits/           # CVE-specific, version-matchable
  <slug>.md
techniques/         # Generic how-to, not tied to a single CVE
  <slug>.md
```

Two top-level directories, flat within each. No nesting. Files are found by search (vector,
keyword, tag filter), not by browsing a tree.

### Reserved files (per OKF)

- `index.md` — directory listing (optional, for humans browsing GitHub)
- `log.md` — chronological changelog (optional)

### Filename convention

Lowercase kebab-case slug. For exploits, use the product name + short descriptor:
`freepbx-sqli-rce.md`, `log4shell.md`, `bigip-auth-bypass.md`. For techniques, use the
method: `mssql-clr-godpotato.md`, `ntlm-relay-http-socks.md`.

Do not encode the CVE number in the filename. The CVE goes in frontmatter where it's
searchable. Filenames are for humans scanning `ls` output.

---

## Exploit documents

Exploit docs describe a specific CVE (or CVE chain) with enough detail for an agent or
pentester to detect, exploit, and post-exploit the vulnerability.

### Frontmatter schema

```yaml
---
type: exploit                       # REQUIRED. Always "exploit".
title: <string>                     # REQUIRED. Human-readable, includes CVE ID.
description: <string>               # REQUIRED. One sentence. Used in search results.
cve: <string>                       # REQUIRED. Primary CVE ID (CVE-YYYY-NNNNN).
aliases: [<string>, ...]            # Optional. Common names (Log4Shell, React2Shell).
product: [<string>, ...]            # REQUIRED. Product names + lowercase variants for matching.
affected: <string>                  # REQUIRED. Version range (semver, free-form, or "< X").
fixed: <string>                     # REQUIRED. First patched version.
cvss: <number>                      # REQUIRED. CVSS v3.1 base score.
severity: <enum>                    # REQUIRED. critical | high | medium | low.
type: <enum>                        # REQUIRED. rce | auth-bypass | lfi | sqli | ssrf | xss | dos | info-disclosure.
auth_required: <boolean>            # REQUIRED. Whether exploitation needs valid credentials.
tags: [<string>, ...]               # REQUIRED. Searchable tags (platform, language, category).
poc: <enum>                         # REQUIRED. vendored | github | link | reference.
poc_url: <string>                   # Optional. URL to PoC repo or script.
poc_license: <string>               # Optional. License of the PoC (MIT, GPL-3.0, check-before-use).
---
```

**`poc` values:**

| Value | Meaning |
|-------|---------|
| `vendored` | PoC script included in repository (license allows redistribution) |
| `github` | Specific GitHub repo with working PoC |
| `link` | URL provided, license unclear or restrictive |
| `reference` | No public PoC; document describes the technique for manual implementation |

### Body structure

```markdown
# <Title>

One-paragraph summary: what it is, why it matters, impact.

## Affected versions

Version details, deployment context, how common the target is.

## Detection

How to identify a vulnerable target: ports, banners, URL paths, version strings.

## Exploitation

Step-by-step with code blocks. Include:
- Public PoC usage (preferred)
- Metasploit module if available
- Manual steps as fallback

## Post-exploitation

What access you land with, where to find credentials/data, common next steps.

## Tags

- ATT&CK: T-codes
- Platform: OS/runtime
- Phase: recon | exploit | postexploit
- OWASP: A-codes (if applicable)
```

All sections are REQUIRED except Tags (recommended).

---

## Technique documents

Technique docs describe a reusable method not tied to a single CVE: a privesc path,
a relay topology, a deployment procedure. They answer "how do I do X when I'm in
situation Y."

### Frontmatter schema

Technique docs use no YAML frontmatter. Tags and metadata are inline in the body.
This is intentional: techniques are freeform and evolve faster than exploits. Forcing
a schema on "NTLM relay via SOCKS" or "deploy a reverse shell agent" adds friction
without improving search quality.

### Body structure

```markdown
# <Title>

## When to use

Bullet list of preconditions. An agent reads this to decide if the technique applies
to its current situation.

## Tags

- ATT&CK: T-codes
- Platform: OS/service
- Services: what must be present
- Privileges: what access level is needed

## How it works

Brief explanation of the mechanism. Not a tutorial; just enough for an experienced
pentester or LLM to understand the chain.

## Prerequisites

Setup steps, config changes, or tools needed before the main procedure.

## Steps (or named sections)

The actual procedure. Named sections beat a single "Steps" heading when the technique
has distinct phases (e.g. "Loading the assembly", "Executing commands", "Cleanup").

## Operational notes

Gotchas, edge cases, failure modes. This is where context-dependent issues go
(like "incron doesn't fire from httpd cgroup").

## Cleanup

How to remove artifacts from the target.

## Proven on

Specific versions/environments where this technique was confirmed working.
```

`When to use` and `Tags` are REQUIRED. All other sections are recommended.

---

## Cross-references

Reference other documents by filename slug in the body text:

> See the `freepbx-incron-privesc` technique for the root escalation path.

Do not use relative paths or markdown links to other docs. Consumers search by slug;
filesystem paths vary by deployment.

## Tag vocabulary

Tags are lowercase, hyphenated. Use existing tags before inventing new ones.

**Platform:** `linux`, `windows`, `macos`, `network`, `web`, `cloud`, `ad`
**Language/runtime:** `java`, `php`, `javascript`, `python`, `dotnet`, `go`, `rust`
**Category:** `unauthenticated`, `authenticated`, `sqli`, `rce`, `auth-bypass`, `lfi`,
`ssrf`, `deserialization`, `command-injection`, `file-upload`, `path-traversal`,
`privilege-escalation`, `lateral-movement`, `persistence`
**Product type:** `firewall`, `vpn`, `print-management`, `voip`, `cms`, `ci-cd`,
`database`, `mail`, `appliance`

---

## Versioning

This spec is `v0.1`. Breaking changes increment the minor version. The spec version
is not embedded in documents; it applies to the repository as a whole.
