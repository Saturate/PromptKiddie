#!/bin/sh
cat << 'MOTD'

  ┌─────────────────────────────────────┐
  │  pk  PromptKiddie Attackbox (full)  │
  └─────────────────────────────────────┘

  Full Kali-based container. Every tool, every phase.
  Built on kalilinux/kali-rolling + RustScan + rustcat + Impacket.

  Recon:    nmap, rustscan, httpx, whatweb, wafw00f, dig, whois
  Enum:     ffuf, gobuster, nikto, nuclei, enum4linux, smbclient, ldapsearch
  Exploit:  sqlmap, metasploit, john, hashcat, hydra, impacket, rustcat
  Util:     curl, wget, python3, ruby, perl, git, jq, ssh
  Wordlists: SecLists + rockyou at /usr/share/wordlists/

  Logging: all commands logged to /workspace/.tool-log/exec.jsonl
  VPN:     pk vpn up | down | status

  Tip: prefer phase containers (pk-recon, pk-enum, pk-exploit)
  for scoped tool access and smaller attack surface.

MOTD
