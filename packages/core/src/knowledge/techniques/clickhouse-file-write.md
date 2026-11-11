# ClickHouse file() Function for Arbitrary Write

## When to use

- ClickHouse access with a user that has FILE privilege (default user often does)
- ClickHouse's `user_files/` directory path overlaps with or is symlinked to a sensitive location
- A root-owned process reads/executes files from a path writable via ClickHouse
- Goal: write arbitrary content to achieve code execution or privilege escalation

## Tags

- ATT&CK: T1068 (Exploitation for Privilege Escalation), T1036 (Masquerading)
- Platform: Linux
- Services: ClickHouse
- Privileges: ClickHouse user with FILE privilege

## How it works

ClickHouse's `file()` table function reads and writes files in the `user_files/`
directory (configured in `config.xml` as `<user_files_path>`). If a privileged
process (cron job, systemd timer, logrotate, backup script) reads or executes files
from this directory or a parent of it, writing a malicious file via ClickHouse
achieves privilege escalation.

## Finding the user_files path

```sql
SELECT * FROM system.settings WHERE name = 'user_files_path';
-- Or check the config
SELECT * FROM file('/etc/clickhouse-server/config.xml', 'RawBLOB');
```

Default: `/var/lib/clickhouse/user_files/`

## Writing a file

```sql
INSERT INTO FUNCTION file('output.sh', 'RawBLOB')
VALUES ('#!/bin/bash\ncp /root/root.txt /tmp/flag.txt\nchmod 644 /tmp/flag.txt\n');
```

Or with TSV format for structured data:

```sql
INSERT INTO FUNCTION file('payload.txt', 'TSV')
SELECT 'malicious content';
```

## Privilege escalation pattern

1. Identify a root-owned script or service that processes files from `user_files/`
   or a directory ClickHouse can write to
2. Write a payload file (script, config, formatter) via `file()`
3. Wait for or trigger the privileged process to execute/read the file
4. Collect the result

On Stream, a root-executed log formatter script sourced files from a directory
that overlapped with ClickHouse's `user_files/` path. Writing a shell script
there and waiting for the formatter cron job achieved root.

## Operational notes

**file() is restricted to user_files/.** ClickHouse does not allow `file()` to
write outside the configured `user_files_path`. But symlinks FROM `user_files/`
to other locations may exist, and the path itself may be in a sensitive location.

**Read before write.** Use `SELECT * FROM file('../../etc/passwd', 'RawBLOB')` to
test if path traversal works (it usually doesn't in recent versions, but older
versions were vulnerable).

**ClickHouse runs as `clickhouse` user.** Files written via `file()` are owned
by the clickhouse user/group. The privileged process reading them must not require
root ownership.

## Proven on

- ClickHouse on Linux (HTB Stream, 2026-10-12): file() write of formatter script to user_files/ directory, executed by root cron job
