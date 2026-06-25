---
name: reporting
description: >-
  Generate the final deliverable — executive summary plus detailed findings (or a CTF
  write-up) built from the engagement database, mapped to frameworks with CVSS scoring.
  Use as the last phase of every engagement.
---

# Reporting

Produce the engagement deliverable from the database. Always the final phase.

## CTF mode (when engagement type is `ctf`)

For CTF engagements, the report is a solve writeup, not a formal assessment.

1. Query findings: `pk finding list` -- these are the captured flags.
2. Query activity: `pk activity list` -- this is the solve timeline.
3. Generate a writeup under `engagements/<slug>/writeup.md` with:
   - Room name, URL (from `source_url`), difficulty
   - Flags captured (list each with how it was found)
   - Attack chain (step by step, derived from the activity log)
   - Tools used
   - Lessons learned
4. Log: `pk activity log --phase report --action "Generated CTF writeup"`
5. Advance phase: `pk engagement phase report`
6. Register: `pk evidence add --path engagements/<slug>/writeup.md --type file`

## Procedure (assessments)

1. Pull state: `pk engagement show <id>`, `pk finding list`, and the activity/evidence index.
2. Start from `templates/report.md`. Write output to
   `engagements/<slug>/report/report.md`.
3. **Executive summary:** plain-language posture + headline risks for non-technical readers.
4. **Findings at a glance:** table sorted by severity (critical → info) with CVSS + status.
5. **Detailed findings:** one section each (use `templates/finding.md` shape) with
   description, reproduction steps, **linked evidence**, framework mapping
   (ATT&CK/OWASP/CVE), impact, and remediation.
6. **Recommendations:** prioritized remediation roadmap.
7. **Appendix:** tooling, full activity timeline, evidence index.
8. Register the report itself: `pk evidence add --path .../report/report.md --type file`.

## CTF write-ups

Collapse into a narrative: recon → foothold → privesc → flags, showing the key commands and
evidence at each step. Keep it reproducible — a reader should be able to follow the solve.

## Quality bar

- Only `confirmed` findings go in the main findings section; keep `triage`-only items in an
  appendix or omit them.
- Every claim is backed by linked evidence.
- Severity/CVSS consistent with `docs/METHODOLOGY.md`.
