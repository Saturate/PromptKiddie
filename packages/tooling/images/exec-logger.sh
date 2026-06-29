#!/bin/sh
# Wraps /bin/sh so that every command executed in the container is logged,
# whether via `pk exec`, raw `docker exec`, or interactive shell.
# Installed as /usr/local/bin/pk-shell and set as the container's default shell.

LOG_DIR="/workspace/.tool-log"
LOG_FILE="$LOG_DIR/exec.jsonl"
mkdir -p "$LOG_DIR" 2>/dev/null

# Detect if this came through pk exec (it sets PK_EXEC=1) or raw docker exec
PK_TRACKED="${PK_EXEC:-0}"

# Log the command
log_cmd() {
  local cmd="$*"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  printf '{"ts":"%s","cmd":"%s","tracked":%s}\n' \
    "$ts" \
    "$(echo "$cmd" | sed 's/"/\\"/g' | tr '\n' ' ')" \
    "$PK_TRACKED" \
    >> "$LOG_FILE" 2>/dev/null
}

# If called as "pk-shell -c 'command'" (the docker exec path), log and exec
if [ "$1" = "-c" ]; then
  shift
  log_cmd "$*"
  exec /bin/sh -c "$*"
fi

# If called with arguments, log and exec
if [ $# -gt 0 ]; then
  log_cmd "$*"
  exec /bin/sh "$@"
fi

# Interactive shell fallback
exec /bin/sh
