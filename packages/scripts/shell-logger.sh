#!/bin/bash
# shell-logger.sh: drop-in SHELL replacement that logs every command to JSONL.
#
# Install: ENV SHELL=/usr/local/bin/shell-logger.sh
#          SHELL ["/usr/local/bin/shell-logger.sh"]
#
# When bash or a harness invokes SHELL -c "command", this script:
#   1. Runs the command, streaming output in real time (tee pattern)
#   2. Records command, exit code, duration, and output to exec.jsonl
#   3. Uses jq for JSON escaping (fixes the sed bug in exec-logger.sh)
#
# Output directory: $PK_LOG_DIR (default: /workspace/.tool-log)

set -uo pipefail

LOG_DIR="${PK_LOG_DIR:-/workspace/.tool-log}"
OUTPUT_DIR="${LOG_DIR}/outputs"
JSONL="${LOG_DIR}/exec.jsonl"
MAX_INLINE=4096

mkdir -p "$OUTPUT_DIR"

# When invoked as SHELL, argv is: shell-logger.sh -c "the command"
# Pass through non-"-c" invocations (e.g. login shells)
if [ "${1:-}" != "-c" ] || [ -z "${2:-}" ]; then
  exec /bin/bash "$@"
fi

CMD="$2"

# Skip logging for trivial/internal commands
case "$CMD" in
  cd\ *|export\ *|source\ *|true|false|:|"") exec /bin/bash -c "$CMD" ;;
esac

TMPOUT=$(mktemp "${LOG_DIR}/.out.XXXXXX")
trap 'rm -f "$TMPOUT"' EXIT
TS_START=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
START_NS=$(date +%s%N 2>/dev/null || echo 0)

# Run command: capture combined output for logging, preserve stderr on terminal
/bin/bash -c "$CMD" > >(tee -a "$TMPOUT") 2> >(tee -a "$TMPOUT" >&2)
EXIT=${PIPESTATUS[0]}

END_NS=$(date +%s%N 2>/dev/null || echo 0)
DURATION_MS=$(( (END_NS - START_NS) / 1000000 ))
OUTPUT_BYTES=$(wc -c < "$TMPOUT")
TOOL=$(echo "$CMD" | awk '{print $1}')

# Store full output if it exceeds inline limit
OUTPUT_PATH=""
if [ "$OUTPUT_BYTES" -gt "$MAX_INLINE" ]; then
  SAFE_TS=$(echo "$TS_START" | tr ':.' '-')
  OUTPUT_PATH="outputs/${TOOL}-${SAFE_TS}.txt"
  cp "$TMPOUT" "${LOG_DIR}/${OUTPUT_PATH}"
fi

# Build JSONL entry with proper escaping via jq
INLINE_OUTPUT=$(head -c "$MAX_INLINE" "$TMPOUT")
printf '%s\n' "$INLINE_OUTPUT" | jq -cRs \
  --arg cmd "$CMD" \
  --argjson exit "$EXIT" \
  --argjson dur "$DURATION_MS" \
  --arg ts "$TS_START" \
  --argjson bytes "$OUTPUT_BYTES" \
  --arg path "$OUTPUT_PATH" \
  '{
    ts: $ts,
    cmd: $cmd,
    exit: $exit,
    duration_ms: $dur,
    output_bytes: $bytes,
    output_path: (if $path == "" then null else $path end),
    output_summary: .
  }' >> "$JSONL"

# --- Version extraction (auto-detect product+version from output) -----------
# Runs in background so it doesn't block the caller.
# Dedup: per-engagement seen-versions file prevents duplicate pk service add calls.

_pk_extract_versions() {
  local tmpout="$1"
  local seen_file="${LOG_DIR}/.seen-versions"
  touch "$seen_file"

  # Only extract if pk and engagement context are available
  if ! command -v pk >/dev/null 2>&1; then return; fi
  local eid="${ENGAGEMENT_ID:-}"
  local tid="${TARGET_ID:-}"
  if [ -z "$eid" ] || [ -z "$tid" ]; then return; fi

  local product version key

  # Pattern 1: HTTP Server header  (Server: nginx/1.24.0)
  grep -oP 'Server:\s*\K[A-Za-z][A-Za-z0-9_.-]*/[0-9]+\.[0-9.]+' "$tmpout" 2>/dev/null | while IFS='/' read -r product version; do
    key="${tid}:${product,,}:${version}"
    grep -qxF "$key" "$seen_file" && continue
    echo "$key" >> "$seen_file"
    pk service add --engagement "$eid" --target "$tid" --product "$product" --ver "$version" --name http --discovered-by shell-logger >/dev/null 2>&1
  done

  # Pattern 2: X-Powered-By header  (X-Powered-By: PHP/8.3.6)
  grep -oP 'X-Powered-By:\s*\K[A-Za-z][A-Za-z0-9_.-]*/[0-9]+\.[0-9.]+' "$tmpout" 2>/dev/null | while IFS='/' read -r product version; do
    key="${tid}:${product,,}:${version}"
    grep -qxF "$key" "$seen_file" && continue
    echo "$key" >> "$seen_file"
    pk service add --engagement "$eid" --target "$tid" --product "$product" --ver "$version" --discovered-by shell-logger >/dev/null 2>&1
  done

  # Pattern 3: Nmap port lines  (22/tcp open ssh OpenSSH 9.6p1)
  grep -oP '(\d+)/tcp\s+open\s+\S+\s+(\S+)\s+([\d]+\.[\d.]+\S*)' "$tmpout" 2>/dev/null | while read -r line; do
    local nport nproduct nversion
    nport=$(echo "$line" | grep -oP '^\d+')
    nproduct=$(echo "$line" | sed -E 's|^[0-9]+/tcp\s+open\s+\S+\s+(\S+)\s+.*|\1|')
    nversion=$(echo "$line" | grep -oP '[\d]+\.[\d.]+\S*')
    key="${tid}:${nproduct,,}:${nversion}"
    grep -qxF "$key" "$seen_file" && continue
    echo "$key" >> "$seen_file"
    pk service add --engagement "$eid" --target "$tid" --port "$nport" --product "$nproduct" --ver "$nversion" --name "$(echo "$line" | awk -F'open ' '{print $2}' | awk '{print $1}')" --discovered-by shell-logger >/dev/null 2>&1
  done

  # Pattern 4: Known products with versions
  grep -oiP '(OpenSSH|Apache|nginx|Dovecot|MySQL|MariaDB|PostgreSQL|Redis|MongoDB|Postfix|vsftpd|ProFTPD|Samba|OpenSTAManager|OliveTin|Roundcube|WordPress|Drupal|Joomla|GitLab|Jenkins|Tomcat|Jetty|IIS)\s*[/: ]([\d]+\.[\d.]+[a-z0-9.]*)' "$tmpout" 2>/dev/null | while read -r match; do
    product=$(echo "$match" | grep -oiP '^(OpenSSH|Apache|nginx|Dovecot|MySQL|MariaDB|PostgreSQL|Redis|MongoDB|Postfix|vsftpd|ProFTPD|Samba|OpenSTAManager|OliveTin|Roundcube|WordPress|Drupal|Joomla|GitLab|Jenkins|Tomcat|Jetty|IIS)')
    version=$(echo "$match" | grep -oP '[\d]+\.[\d.]+[a-z0-9.]*$')
    [ -z "$product" ] || [ -z "$version" ] && continue
    key="${tid}:${product,,}:${version}"
    grep -qxF "$key" "$seen_file" && continue
    echo "$key" >> "$seen_file"
    pk service add --engagement "$eid" --target "$tid" --product "$product" --ver "$version" --discovered-by shell-logger >/dev/null 2>&1
  done
}

BGOUT="${TMPOUT}.bg"
cp "$TMPOUT" "$BGOUT"
( _pk_extract_versions "$BGOUT"; rm -f "$BGOUT" ) &

exit "$EXIT"
