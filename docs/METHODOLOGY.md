# Methodology

PromptKiddie is **methodology-first**. Every engagement follows the same phased process,
adapted to its type. The orchestrator advances through phases in order, but may loop back
(e.g. new recon after a foothold). Each phase has an owning sub-agent and writes to the
`activity_log`.

This process aligns with **PTES** (Penetration Testing Execution Standard), the
**OWASP WSTG** for web, and maps findings to **MITRE ATT&CK** and **CVE/CVSS**.

## Phase 0: Authorization & scoping (always first)

**Nothing happens before this.** Create the engagement and its Rules of Engagement.

- Define type (`ctf` / `whitebox` / `blackbox` / `bugbounty`), scope (in/out), allowed
  actions, time windows, and emergency contacts.
- For bug bounty: capture the program's policy and explicit out-of-scope rules.
- The orchestrator must refuse any action against a target not marked in-scope.

→ Template: `templates/rules-of-engagement.md`. Stored on the `engagements` row.

## Phase 1: Reconnaissance

Map the attack surface. *Owner: `recon-agent`.*

- **Passive** (black box): OSINT, DNS, subdomains, certificate transparency, leaked creds,
  tech fingerprinting. No direct contact where it matters.
- **Active**: host discovery, port scanning, service/version detection.
- White box: also ingest provided architecture/source/inventory.

Typical tools: `nmap`, `masscan`, `amass`, `subfinder`, `dnsx`, `httpx`, `whatweb`.
ATT&CK: Reconnaissance (TA0043), Resource Development (TA0042).

## Phase 2: Enumeration

Deepen knowledge of each in-scope service. *Owner: `enum-agent`.*

- Web: directory/vhost brute, parameter discovery, auth flows, API surfaces (OWASP WSTG).
- Network: SMB/LDAP/SNMP/NFS enumeration, default creds, misconfigurations.
- Identify candidate vulnerabilities; record them as `findings` in `triage` status.

Typical tools: `ffuf`, `gobuster`, `nuclei`, `feroxbuster`, `enum4linux-ng`, `nikto`.

## Phase 3: Exploitation

Validate vulnerabilities by gaining access. *Owner: `exploit-agent`.*

- Prefer least-impact PoC that proves the issue; respect RoE on disruptive techniques.
- Capture evidence at the moment of proof (screenshot, response, shell output).
- Promote validated `findings` from `triage` → `confirmed` with CVSS + ATT&CK technique.

Typical tools: `sqlmap`, `metasploit`, `hydra`, custom PoCs. ATT&CK: Initial Access
(TA0001), Execution (TA0002).

## Phase 4: Post-exploitation

Demonstrate impact within scope. *Owner: `exploit-agent`.*

- Privilege escalation, lateral movement, sensitive-data access, **only if in scope**.
- For CTF: capture user/root flags. For engagements: prove business impact conservatively.
- ATT&CK: Privilege Escalation (TA0004), Lateral Movement (TA0008), Collection (TA0009).

## Phase 5: Reporting & write-up

Produce the deliverable. *Owner: `report-agent`.* **Always the last step.**

- Generate an executive summary + technical findings from the database.
- Each finding: description, reproduction steps, evidence, OWASP/ATT&CK/CVE mapping, CVSS,
  remediation. CTF: a clean write-up of the solve path.
- Output to `templates/report.md`-shaped markdown under the engagement directory.

## Severity / scoring

Use **CVSS v3.1** for engagements; severity buckets:

| Severity | CVSS        | Typical use                                  |
| -------- | ----------- | -------------------------------------------- |
| critical | 9.0–10.0    | RCE, auth bypass to admin, full DB exposure  |
| high     | 7.0–8.9     | Significant data exposure, privesc           |
| medium   | 4.0–6.9     | Limited disclosure, CSRF, weak config        |
| low      | 0.1–3.9     | Info leak, minor misconfig                   |
| info     | 0.0         | Hardening notes, observations                |

## Operating principles

- **Stay in scope.** When in doubt, stop and ask via the inbox.
- **Log as you go.** Every command and result goes to `activity_log`; every artifact to
  `evidence`. The database is the engagement's memory.
- **Evidence before claims.** A finding is `confirmed` only with reproducible evidence.
- **Least impact.** Prove, don't destroy. Honor disruptive-action limits in the RoE.
