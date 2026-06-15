# <ENGAGEMENT NAME>: Security Assessment Report

- **Type:** <ctf | whitebox | blackbox | bugbounty>
- **Period:** <start> – <end>
- **Tester:** <name>
- **Authorized by:** <name>

---

## 1. Executive summary

<Plain-language overview for non-technical stakeholders: what was tested, overall posture,
and the headline risks. CTF: a one-paragraph summary of the solve.>

### Findings at a glance

| # | Title | Severity | CVSS | Status |
| - | ----- | -------- | ---- | ------ |
| 1 |       |          |      |        |

## 2. Scope & methodology

- **In scope:** <…>
- **Out of scope:** <…>
- **Approach:** Followed PromptKiddie methodology (recon → enumeration → exploitation →
  post-exploitation), mapping findings to MITRE ATT&CK / OWASP / CVE with CVSS v3.1 scoring.

## 3. Findings (detailed)

> One subsection per finding, generated from the `findings` table. Each includes
> description, reproduction, evidence, framework mapping, impact, and remediation
> (see `templates/finding.md`).

### 3.1 <Finding title> [<severity>]

<...>

## 4. Recommendations

<Prioritized remediation roadmap.>

## 5. Appendix

- Tooling used
- Full activity timeline (from `activity_log`)
- Evidence index (from `evidence`)

---

### CTF write-up note

For CTFs, sections 1–3 collapse into a narrative walkthrough of the solve path: recon →
foothold → privesc → flags, with the commands and evidence that got you there.
