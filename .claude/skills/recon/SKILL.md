---
name: recon
description: >-
  Reconnaissance procedure for an engagement — map the attack surface (passive OSINT/DNS/
  subdomains and active host/port/service discovery), then record targets and activity to
  the database. Use at the start of an engagement (Phase 1) or when new scope appears.
---

# Recon

Map the attack surface for in-scope targets. Always confirm scope first via the active
engagement's RoE. Log targets, activity, and evidence with `pk`.

## Procedure

1. **Confirm scope.** `pk engagement show <id>` and `pk target list`. Only touch in-scope
   assets. For black box, prefer passive first.
2. **Passive (low/no contact):**
   - DNS & subdomains: `subfinder`, `amass`, `dnsx`, certificate transparency (crt.sh).
   - OSINT: tech stack, emails, leaked creds, public repos.
3. **Active discovery (if RoE allows):**
   - Fast port scan + service detection: `rustscan -a <target> -- -sV -sC` (rustscan finds
     open ports in seconds, then hands them to nmap for version/script detection).
   - Web probing: `httpx`, `whatweb` to fingerprint live services.
4. **Record results:**
   - New hosts/domains/URLs → `pk target add --kind <kind> --id <identifier> --in-scope`
     (only mark in-scope if the RoE actually covers it).
   - Save raw output under `engagements/<slug>/recon/` and `pk evidence add` it.
   - `pk activity log --phase recon --action "nmap full scan" --command "<cmd>"`.
5. **Summarize** the surface (open ports, services, versions, interesting endpoints) and
   hand off candidate areas to enumeration.

## Tips

- Tag anything notable for ATT&CK Reconnaissance (TA0043).
- Don't scan out-of-scope hosts even if discovered — record them as out-of-scope targets.
- Capture timestamps; recon output is the baseline for the report's timeline.
