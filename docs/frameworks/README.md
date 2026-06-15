# Frameworks

PromptKiddie maps every finding to shared frameworks so reports are standard, comparable,
and actionable. Use the canonical identifiers below when populating `findings`.

## MITRE ATT&CK

Tactics and techniques for adversary behavior. Tag findings/activity with technique IDs.

- Format: `Txxxx` or `Txxxx.yyy` (sub-technique), e.g. `T1190` (Exploit Public-Facing
  Application), `T1059.001` (PowerShell).
- Reference: https://attack.mitre.org/
- Store as an array on `findings.attackTechniques`.

Common offensive tactics:

| Tactic                | ID      | Phase mapping            |
| --------------------- | ------- | ------------------------ |
| Reconnaissance        | TA0043  | Recon                    |
| Resource Development  | TA0042  | Recon                    |
| Initial Access        | TA0001  | Exploitation             |
| Execution             | TA0002  | Exploitation             |
| Privilege Escalation  | TA0004  | Post-exploitation        |
| Lateral Movement      | TA0008  | Post-exploitation        |
| Exfiltration          | TA0010  | Post-exploitation        |

## OWASP

For web/app findings. Reference the relevant standard:

- **Top 10 (2021)**: `A01:2021`–`A10:2021`, e.g. `A03:2021` (Injection).
- **WSTG** (Web Security Testing Guide): test IDs like `WSTG-ATHN-01`.
- **ASVS** (Application Security Verification Standard): verification requirements.
- Reference: https://owasp.org/
- Store as a string/array on `findings.owasp`.

## CVE + CVSS

- **CVE**: known-vulnerability IDs, format `CVE-YYYY-NNNNN`. Store on `findings.cve` (array).
- **CVSS v3.1**: base score 0.0–10.0 → severity bucket (see `METHODOLOGY.md`). Store the
  numeric score on `findings.cvss` and the bucket on `findings.severity`.
- Calculator: https://www.first.org/cvss/calculator/3.1

## PTES

The Penetration Testing Execution Standard frames the overall process (pre-engagement →
intelligence gathering → threat modeling → vuln analysis → exploitation → post-exploitation
→ reporting). PromptKiddie's phases (`METHODOLOGY.md`) follow it. Reference:
http://www.pentest-standard.org/
