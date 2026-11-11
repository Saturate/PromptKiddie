# Password Sniffing via /proc/*/cmdline

## When to use

- Linux shell access as any user
- Services or scripts pass passwords as command-line arguments
- Goal: capture credentials from short-lived processes (cron jobs, database clients, backup scripts)

## Tags

- ATT&CK: T1552.001 (Credentials In Files), T1057 (Process Discovery)
- Platform: Linux
- Services: any (MySQL, PostgreSQL, ClickHouse, curl, rsync, etc.)
- Privileges: any local user (procfs is world-readable by default)

## How it works

On Linux, `/proc/<pid>/cmdline` is readable by any user (unless `hidepid=2` is set
on the procfs mount). When a program is invoked with a password on the command line
(e.g. `clickhouse-client --password s3cret`), it's visible to all users for the
lifetime of the process.

Short-lived processes (a cron job that runs `mysql -p<password>`) are only visible
briefly. A polling loop catches them.

## Sniffing with a loop

```bash
# Continuous sniff - log all unique cmdlines
while true; do
  for f in /proc/[0-9]*/cmdline; do
    cat "$f" 2>/dev/null | tr '\0' ' '
    echo
  done
done | sort -u | grep -iE 'pass|secret|key|token|auth'
```

### Targeted sniff for a specific binary

```bash
# Catch clickhouse-client invocations
while true; do
  ps aux 2>/dev/null | grep -v grep | grep 'clickhouse-client'
done
```

### Using pspy (precompiled, no dependencies)

```bash
# pspy monitors process creation via inotify on /proc
./pspy64 -p -i 100
```

## Operational notes

**Processes clean up argv.** Some programs overwrite their argv after startup (MySQL
does this with `-p`). The password is only visible in the first milliseconds. Poll
aggressively with `while true` loops, not `watch -n 1`.

**hidepid mount option.** If `/proc` is mounted with `hidepid=2`, non-root users
can only see their own processes. Check with `mount | grep proc`. This blocks the
technique entirely for unprivileged users.

**Cron timing.** If the target process runs on a cron schedule, check
`/etc/crontab`, `/var/spool/cron/`, and `systemctl list-timers` to predict when
to start sniffing.

**ClickHouse specifics.** ClickHouse's `clickhouse-client` accepts `--password`
on the command line. Backup and maintenance scripts often call it this way. The
`default` user password in ClickHouse is particularly valuable since it often has
full database access.

## Proven on

- ClickHouse default password via `clickhouse-client --password` (HTB Stream, 2026-10-12): cron-scheduled maintenance script caught by polling loop
