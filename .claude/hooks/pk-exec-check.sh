#!/bin/bash
# PreToolUse hook: block raw docker exec against PK containers and track inline command count.
# Exit 0 = allow, Exit 2 = block with message shown to the model.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ "$TOOL" != "Bash" ]; then exit 0; fi

COUNTER_FILE="/tmp/.pk-inline-cmd-count"
PK_CONTAINERS="promptkiddie-attackbox|promptkiddie-tooling|promptkiddie-attack|promptkiddie-recon|attackbox"

# --- Block raw docker exec against PK containers ---
if echo "$CMD" | grep -qE "docker exec.*(${PK_CONTAINERS})" && ! echo "$CMD" | grep -q "pk exec"; then
  # Allow explicit override with PK_RAW_DOCKER=1
  if echo "$CMD" | grep -q "PK_RAW_DOCKER=1"; then
    exit 0
  fi
  echo "BLOCKED: Use 'pk exec -- <command>' or 'pk webshell exec' instead of raw 'docker exec'."
  echo "This ensures commands are logged to the engagement audit trail."
  echo "If you must bypass, prefix with PK_RAW_DOCKER=1."
  exit 2
fi

# --- Track inline target-facing commands for delegation budget ---
if echo "$CMD" | grep -qE "(docker exec|pk exec|pkx )" || \
   echo "$CMD" | grep -qE "curl.*(--data-urlencode|cmd=)"; then
  COUNT=0
  [ -f "$COUNTER_FILE" ] && COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
  COUNT=$((COUNT + 1))
  echo "$COUNT" > "$COUNTER_FILE"

  if [ "$COUNT" -ge 20 ]; then
    echo "BLOCKED: You have run $COUNT target-facing commands inline without delegating to an agent."
    echo "Spawn an exploit-agent or recon-agent for this work. Orchestrator context is expensive."
    echo "Reset the counter by spawning an agent (the counter resets on next session or Agent tool use)."
    exit 2
  elif [ "$COUNT" -ge 10 ]; then
    echo "[pk] WARNING: $COUNT inline target commands. Consider spawning an agent." >&2
    echo "[pk] The delegation heuristic says: max 10 inline commands before delegating." >&2
  fi
fi

exit 0
