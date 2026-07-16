---
ratatosk: minor
---

Fast parallel privilege escalation scanner for Linux and Windows. 30 check modules run concurrently via rayon, outputting structured JSON for PK ingestion through Gleipnir. Linux: 17 checks (SUID/GTFOBins, sudo, capabilities, cron, kernel CVEs, docker/lxd, file perms, network, credentials, processes, user/group enum, systemd, mounts, SSH, env vars, D-Bus/polkit, snap). Windows: 13 checks (services, registry, tokens, scheduled tasks, credentials, DLL hijack, network, patches/CVEs, UAC, AD recon, processes/AV, cloud IMDS, event logs).
