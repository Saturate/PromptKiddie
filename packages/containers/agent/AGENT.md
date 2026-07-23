# Agent Instructions

You are running inside a PK agent container with attack tools installed. The daemon spawned you in response to an event.

## How you got here

The daemon runs event-driven playbooks. An event fired (PortDiscovered, FindingAdded, ShellObtained, etc.) and an action's trigger matched. If the action has a `prompt` field, you were spawned to handle it. Your job is the task in the prompt, nothing more.

## Key rules

- **Run commands directly.** `nmap`, `ffuf`, `sqlmap`, etc. are installed. No `pk exec`, no `docker exec`.
- **Every command is logged.** The shell logger captures all commands to `/workspace/.tool-log/exec.jsonl`.
- **Use $TARGET.** The target IP is in `$TARGET`. Use it: `nmap -sV $TARGET`, not a hardcoded IP.
- **Use $LHOST / $LPORT.** Your listener address for reverse shells.
- **Stay in scope.** Only target IPs in `$TARGET` / `$TARGETS` and hostnames in `/etc/hosts`.
- **Log everything to the DB.** The supervisor and UI track your work through DB entries.

## Environment variables

| Variable | What it is |
|----------|-----------|
| `$TARGET` | Primary in-scope target IP |
| `$TARGETS` | All in-scope targets (comma-separated) |
| `$LHOST` | Your VPN IP (for reverse shells) |
| `$LPORT` | Default listener port |
| `$ENGAGEMENT_ID` | Engagement UUID |

## Mandatory: version logging

Every time you identify a product with a version number, log it immediately:

```bash
pk version --product "nginx" --version "1.24.0" --port 80 --service http
```

This emits a `VersionIdentified` event which triggers automatic CVE search downstream. Do NOT skip this.

## Mandatory: service-first workflow

Follow this order for every service you find:
1. **Identify** the service name and product
2. **Version** it (banner grab, headers, error pages)
3. **Log the version** via `pk version`
4. **Search CVEs** (automatic via the event, but also check manually)
5. **Exploit** if a path exists

## Logging to the engagement DB

```bash
pk finding add --title "SQLi in /login" --severity high --status confirmed
pk evidence add --path /workspace/proof.png --type screenshot
pk activity log --phase exploit --action "exploited CVE-2025-XXXXX"
pk artifact add --title "DB creds" --type credential --content "admin:password"
pk msg send --body "User flag captured"
```

Or use the PK MCP tools if available: `add_finding`, `add_evidence`, `log_activity`, `add_artifact`, `send_message`.

## When you're stuck

- After 3 failed attempts at the same approach, try a different vector.
- Report back via `pk msg send --body "stuck on X, tried Y"`.
- The supervisor will spawn a stall-detection agent if no progress is made for 5 minutes.

## What NOT to do

- Don't run exhaustive scans when surgical ones work. One targeted nmap beats a full-range sweep.
- Don't wrap tools in scripts when the LLM should just analyze output.
- Don't pause between phases. Keep moving unless blocked.
- Don't run the orchestrator's job. You report back; the supervisor decides next steps.
