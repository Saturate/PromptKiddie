#!/bin/sh
cat << 'MOTD'

  ┌──────────────────────────────────────┐
  │  pk  PromptKiddie Attackbox (recon)  │
  └──────────────────────────────────────┘

  Reconnaissance phase container.
  Map the attack surface: hosts, ports, services, technologies.

  Tools: nmap, rustscan, httpx, whatweb, wafw00f, dig, whois
  Wordlists: n/a (use pk-enum for content discovery)
  Logging: all commands logged to /workspace/.tool-log/exec.jsonl

  Usage:  pk exec -- nmap -sV -sC <target>
          pk exec -- rustscan -a <target> -- -sV

MOTD
