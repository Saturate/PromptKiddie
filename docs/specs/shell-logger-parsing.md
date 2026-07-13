# Shell Logger Version Parsing

Auto-detect product versions from tool output and emit VersionIdentified events
without agent intervention.

## Problem

Agents discover versions in tool output (nmap banners, HTTP headers, login pages) but
forget to call `pk version`. The shell logger already captures all command output to
JSONL. Adding a version parser to the logger closes the gap with zero agent effort.

## Approach

After logging a command's output to exec.jsonl, run a regex pass over the output to
extract product/version pairs. For each match, call `pk version` (or write directly
to the DB if pk-rs is available).

### Version patterns

```
# Server headers
Server: nginx/1.24.0
X-Powered-By: PHP/8.3.6
X-Powered-By: Express

# Nmap service detection
22/tcp open ssh OpenSSH 9.6p1 Ubuntu
80/tcp open http Apache/2.4.58

# Common banners
220 mail.example.com Dovecot (Ubuntu) ready.
MySQL 8.0.36-0ubuntu0.22.04.1

# Application fingerprints
<meta name="generator" content="WordPress 6.5.2">
Powered by OpenSTAManager 2.9.8
```

### Regex set

```bash
# HTTP Server header
/Server:\s*(\S+)\/([\d.]+)/

# X-Powered-By
/X-Powered-By:\s*(\S+)\/([\d.]+)/

# Nmap port line
/\d+\/tcp\s+open\s+\S+\s+(\S+)\s+([\d.]+)/

# Generic product/version (conservative)
/(OpenSSH|Apache|nginx|Dovecot|MySQL|MariaDB|PostgreSQL|Redis|MongoDB|Postfix|vsftpd|ProFTPD|Samba|OpenSTAManager|OliveTin|Roundcube|WordPress|Drupal|Joomla|GitLab|Jenkins|Tomcat|Jetty|IIS)\s*[\/\s]?([\d]+\.[\d.]+)/i
```

### Dedup

Track emitted product+version pairs per engagement to avoid duplicate events. A simple
set in the logger process, or check the discoveries table before emitting.

## Implementation options

### Option A: In shell-logger.sh (bash, v1)

Add a post-logging step that greps the output file:

```bash
# After writing JSONL entry
grep -oP 'Server:\s*\K\S+/[\d.]+' "$TMPOUT" | while read pv; do
  product="${pv%%/*}"
  version="${pv##*/}"
  pk version --product "$product" --version "$version" &
done
```

Downside: spawning `pk version` (Node.js) per match is slow. Better to batch.

### Option B: In pk-rs shell-logger (Rust, v2)

The Rust shell logger parses output with compiled regexes and writes directly to the
DB via sqlx. No process spawn per match. This is the correct long-term solution.

### Option C: Async post-processor

A separate process watches exec.jsonl (tail -f) and runs the regex pass. Decoupled
from the logger, can be added/removed without changing the shell.

## Recommendation

Option A for now (cheap, works today). Option B when pk-rs ships. Option C only if
the logger can't be modified (e.g. third-party containers).

## Scope

Only extract versions from known-reliable patterns (Server headers, nmap output,
well-known banners). Do NOT try to parse arbitrary HTML for version strings; that
produces too many false positives and should remain an agent judgment call.
