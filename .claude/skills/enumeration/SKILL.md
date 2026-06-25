---
name: enumeration
description: >-
  Enumeration procedure — deepen knowledge of each in-scope service (web content/params/
  auth, network shares/services/default creds) and record candidate vulnerabilities as
  triage findings. Use in Phase 2 after recon identifies live services.
---

# Enumeration

Turn the recon surface into concrete, testable leads. Record candidate vulns as `findings`
in `triage` status; promote them later during exploitation.

## Web (OWASP WSTG)

1. Content discovery: `ffuf`/`feroxbuster`/`gobuster` for dirs, files, vhosts.
2. Parameter & API discovery; map auth flows and session handling.
3. Quick vuln scan: `nuclei -t <templates>`, `nikto` — triage results, don't trust blindly.
4. Tag candidates with OWASP refs (e.g. `A03:2021`, `WSTG-INPV-*`).

## Custom wordlists

Standard wordlists (rockyou.txt, SecLists) won't always work. Generate target-specific
wordlists before brute-forcing:

1. **CeWL** — scrape words from the target's web pages:
   `cewl http://TARGET -w /tmp/cewl-wordlist.txt -d 2 -m 5`
   This catches passwords derived from the organization's own content (product names,
   employee names, jargon, lorem ipsum text). Many CTFs use this as the intended path.
2. **Username variants** — if you find a name like "Tyler Smith", generate:
   `tyler, Tyler, tsmith, t.smith, tyler.smith, TSmith`
3. **Combine** — merge CeWL output with common mutations (append numbers, capitalize):
   `john --wordlist=/tmp/cewl-wordlist.txt --rules --stdout > /tmp/mutated.txt`

Always try custom wordlists before falling back to rockyou.txt. If the engagement brief
says "passwords are not in rockyou.txt", CeWL is almost certainly the intended approach.

## Network

1. Service-specific enum: SMB/LDAP/SNMP/NFS/RPC (`enum4linux-ng`, `smbclient`, `ldapsearch`).
2. Check default/weak credentials where RoE permits.
3. Note misconfigurations, exposed shares, version-specific CVEs.

## Record

- Save tool output under `engagements/<slug>/enum/` and `pk evidence add`.
- For each lead: `pk finding add --title "<candidate>" --severity <est> --status triage
  [--owasp ...] [--cve ...] [--target <id>] --desc "<why suspected>"`.
- `pk activity log --phase enum --action "<what>" --command "<cmd>"`.

## Inbox

Keep the human informed via the inbox:
`pk msg send --body "<status>" --direction outbound --author agent`

Send a message when starting, when you find something notable, and when done.
Check for inbound messages with `pk msg poll` and respond if any.

## Tips

- Prioritize by likely impact and ease of validation.
- A finding stays `triage` until exploitation proves it — don't over-claim.
- Re-run recon if enumeration reveals new in-scope surface.
