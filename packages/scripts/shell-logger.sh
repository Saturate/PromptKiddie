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

exit "$EXIT"
