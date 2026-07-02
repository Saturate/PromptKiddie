---
name: evidence-logging
description: >-
  How to capture, store, hash, and link evidence and activity to the engagement database so
  everything is auditable and reproducible. Use whenever you run a tool, prove a finding, or
  take any notable action.
---

# Evidence & logging

The database is the engagement's memory. If it isn't logged, it didn't happen. Use the `pk`
CLI for everything.

## Where artifacts live

```
engagements/<engagement-slug>/
  recon/        nmap, subfinder, httpx output
  enum/         ffuf, nuclei, enum tool output
  exploit/      PoC scripts, shell logs, screenshots
  loot/         downloaded files (handle per RoE data rules)
  report/       generated write-up
```

This directory is **gitignored** — never commit target/client data.

## Logging recipes

```bash
# Register an artifact (computes sha256, links to engagement / optional finding)
pk evidence add --path engagements/<slug>/recon/nmap.txt --type scan
pk evidence add --path engagements/<slug>/exploit/shell.png --type screenshot --finding <id>

# Append to the audit trail
pk activity log --phase recon --action "Full TCP scan" --command "nmap -p- 10.10.10.5"

# Record a finding with framework tags
pk finding add --title "SQLi in /login" --severity high --cvss 8.1 \
  --owasp A03:2021 --attack T1190 --target <id> --status confirmed \
  --desc "Boolean-based blind SQLi in username param"
```

## Command execution

All tool commands must run via `pk exec` to ensure they are logged and timestamped:

    pk exec -- nmap -p- 10.10.10.5
    pk exec --reason "checking for SQL injection" -- sqlmap -u "http://target/login"

`pk exec` automatically logs the command to `activity_log`, truncates output >4KB (stores
full output server-side), enforces timeouts, and enables `pk search` across stored outputs.

Do not bypass `pk exec` even in automation or sub-agents.

## Rules

- Capture evidence **at the moment of proof**, before you change anything.
- Hash everything (`pk evidence add` does this) so artifacts are tamper-evident.
- Reference evidence from findings, and findings from activity, so the report can be
  reconstructed entirely from the DB.
- Handle sensitive data per the RoE; minimize what you download/store.
