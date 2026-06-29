#!/bin/sh
cat << 'MOTD'

  ┌─────────────────────────────────────┐
  │  pk  PromptKiddie Attackbox (enum)  │
  └─────────────────────────────────────┘

  Enumeration phase container.
  Deepen knowledge: fuzz directories, enumerate shares, find vulns.

  Tools: ffuf, gobuster, nikto, nuclei, enum4linux, smbclient, ldapsearch
  Wordlists: SecLists + Kali defaults at /usr/share/wordlists/
  Logging: all commands logged to /workspace/.tool-log/exec.jsonl

  Usage:  pk exec -- ffuf -u http://<target>/FUZZ -w /usr/share/seclists/Discovery/Web-Content/common.txt
          pk exec -- nuclei -u http://<target> -tags cve

MOTD
