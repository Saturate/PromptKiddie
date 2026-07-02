#!/bin/bash
# PreToolUse hook: warn when Bash commands target Docker containers without pk exec.
# Non-blocking - prints a warning the agent sees but doesn't prevent execution.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ "$TOOL" != "Bash" ]; then exit 0; fi

# Check for bare docker exec (not wrapped in pk exec)
if echo "$CMD" | grep -q "docker exec" && ! echo "$CMD" | grep -q "pk exec"; then
  echo "[pk] WARNING: Use 'pk exec -- <command>' instead of raw 'docker exec' for audit trail logging." >&2
fi

exit 0
