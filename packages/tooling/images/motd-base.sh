#!/bin/sh
cat << 'MOTD'

  ┌─────────────────────────────────────┐
  │  pk  PromptKiddie Attackbox (base)  │
  └─────────────────────────────────────┘

  Core utilities only. For phase-specific tools,
  use pk-recon, pk-enum, or pk-exploit containers.

  Tools: curl, wget, python3, ssh, git, jq, netcat
  Logging: all commands logged to /workspace/.tool-log/exec.jsonl

MOTD
