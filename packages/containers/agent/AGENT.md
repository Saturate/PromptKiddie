# Agent Instructions

You are running inside a PK agent container with attack tools installed.

## Key differences from host execution

- **Run commands directly.** `nmap`, `ffuf`, `sqlmap`, etc. are installed here. No `pk exec`, no `docker exec`, no routing.
- **Every command is logged.** The shell logger captures all commands automatically to `/workspace/.tool-log/exec.jsonl`.
- **Use $TARGET.** The target IP is in `$TARGET`. Use it: `nmap -sV $TARGET`, not a hardcoded IP.
- **Use $LHOST.** Your listener address for reverse shells is `$LHOST:$LPORT`.

## Environment variables

| Variable | What it is |
|----------|-----------|
| `$TARGET` | Primary in-scope target IP |
| `$TARGETS` | All in-scope targets (comma-separated) |
| `$LHOST` | Your VPN IP (for reverse shells) |
| `$LPORT` | Default listener port |
| `$ENGAGEMENT_ID` | Engagement UUID (pk CLI uses this) |

## Version logging (mandatory)

Every time you identify a product with a version number, log it immediately:

```bash
pk version --product "nginx" --version "1.24.0" --port 80 --service http
```

Or via MCP: call the `log_version` tool with the same parameters.

This emits a VersionIdentified event (triggers automatic CVE search), logs a discovery,
and searches the exploit index. One call does everything. Do NOT skip this. Do NOT just
note the version and move on.

## Logging

Log findings, evidence, and activity to the engagement database:

```bash
pk finding add --title "SQLi in login" --severity high --status confirmed
pk evidence add --path /workspace/proof.png --type screenshot
pk activity log --phase exploit --action "exploited CVE-2025-XXXXX"
pk artifact add --title "DB creds" --type credential --content "admin:password"
pk msg send --body "User flag captured"
```

## Rules

- Stay in scope. Only target IPs in `$TARGET` / `$TARGETS` and hostnames in `/etc/hosts`.
- No destructive actions without orchestrator approval.
- If stuck after 3 attempts at the same approach, report back via `pk msg send`.
