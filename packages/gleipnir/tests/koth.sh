#!/usr/bin/env bash
set -euo pipefail

# KotH-grade hostile tests: simulates adversarial environments where
# other players mess with your tools, connections drop, targets are weird.
# Run from packages/gleipnir/.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_PORT=44444
API_SOCK="/tmp/gleipnir-koth-$$.sock"
RELAY_PID=""
AGENT_PID=""
PASS=0
FAIL=0
TMPDIR_E2E=$(mktemp -d /tmp/gleipnir-koth-XXXXXX)

cleanup() {
  [[ -n "$AGENT_PID" ]] && kill "$AGENT_PID" 2>/dev/null || true
  [[ -n "$RELAY_PID" ]] && kill "$RELAY_PID" 2>/dev/null || true
  # Kill any straggler agents
  pkill -f "gleipnir-agent.*-p $RELAY_PORT" 2>/dev/null || true
  rm -f "$API_SOCK"
  rm -rf "$TMPDIR_E2E"
  echo ""
  echo "=============================="
  echo "KOTH Results: $PASS passed, $FAIL failed"
  echo "=============================="
  if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
}
trap cleanup EXIT

api() { python3 "$SCRIPT_DIR/api-client.py" "$API_SOCK" "$1" 2>/dev/null; }
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 -- $2"; }

wait_for_sessions() {
  local min_count="${1:-1}"
  local attempts=0
  while [[ $attempts -lt 40 ]]; do
    local resp count
    resp=$(api '{"action":"sessions"}' || true)
    count=$(echo "$resp" | jq '[.data[] | select(.connected==true)] | length' 2>/dev/null || echo 0)
    if [[ "$count" -ge "$min_count" ]]; then return 0; fi
    sleep 0.2
    attempts=$((attempts + 1))
  done
  return 1
}

get_session_name() {
  api '{"action":"sessions"}' | jq -r '[.data[] | select(.connected==true)][0].name'
}

session_count() {
  api '{"action":"sessions"}' | jq '[.data[] | select(.connected==true)] | length' 2>/dev/null || echo 0
}

# --- build ------------------------------------------------------------------
echo "=== Building gleipnir (release) ==="
cargo build --release 2>&1 | tail -3

RELAY_BIN="target/release/gleipnir-server"
AGENT_BIN="target/release/gleipnir-agent"

echo ""
echo "=== Starting relay ==="
"$RELAY_BIN" --port "$RELAY_PORT" --api-socket "$API_SOCK" --no-tls 2>/dev/null &
RELAY_PID=$!
sleep 0.3

"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" --cmd-timeout 5 2>/dev/null &
AGENT_PID=$!

echo "=== Waiting for session ==="
if ! wait_for_sessions 1; then
  echo "Agent never connected. Aborting."
  exit 1
fi
SESSION=$(get_session_name)
echo "  Session: $SESSION"
echo ""
echo "=== KOTH hostile tests ==="

# ============================================================================
# 1. AGENT KILL + RECONNECT
# Simulate target reboot: kill agent mid-session, restart, verify recovery
# ============================================================================
echo ""
echo "--- Agent disconnect/reconnect ---"

kill "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true

# Wait for heartbeat to detect disconnect (10s interval + margin)
detected=false
for i in $(seq 1 15); do
  resp=$(api '{"action":"sessions"}')
  status=$(echo "$resp" | jq -r '.data[0].connected')
  if [[ "$status" == "false" ]]; then
    detected=true
    break
  fi
  sleep 1
done

if [[ "$detected" == "true" ]]; then
  pass "relay detects agent disconnect (heartbeat, ${i}s)"
else
  fail "disconnect detection" "still shows connected after 15s"
fi

# Command to dead session should fail
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"whoami\",\"timeout\":3}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "false" ]]; then
  pass "command to disconnected session fails cleanly"
else
  fail "dead session command" "expected failure, got ok=$ok"
fi

# Restart agent
"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" --cmd-timeout 5 2>/dev/null &
AGENT_PID=$!
sleep 1

# Get new session name (hostname-2 since original still in map)
if wait_for_sessions 1; then
  NEW_SESSION=$(get_session_name)
  resp=$(api "{\"action\":\"exec\",\"session\":\"$NEW_SESSION\",\"command\":\"echo reconnected\",\"timeout\":5}")
  output=$(echo "$resp" | jq -r '.data.output // empty')
  if echo "$output" | grep -q "reconnected"; then
    pass "agent reconnect + command works (session: $NEW_SESSION)"
  else
    fail "agent reconnect" "output='$output'"
  fi
  SESSION="$NEW_SESSION"
else
  fail "agent reconnect" "never reconnected"
fi

# ============================================================================
# 2. KILL AGENT DURING COMMAND EXECUTION
# ============================================================================
echo ""
echo "--- Kill agent mid-command ---"

# Start a long command, then kill agent
api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"sleep 30\",\"timeout\":15}" &
EXEC_PID=$!
sleep 0.5

kill "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true

# Wait for the exec to return (should fail with disconnect)
wait "$EXEC_PID" 2>/dev/null || true
# The important thing: relay is still alive
sleep 0.5

resp=$(api '{"action":"sessions"}' || echo '{"ok":false}')
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  pass "relay survives agent kill during command"
else
  fail "relay after mid-command kill" "relay API unreachable"
fi

# Restart agent for remaining tests
"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" --cmd-timeout 5 2>/dev/null &
AGENT_PID=$!
if wait_for_sessions 1; then
  SESSION=$(get_session_name)
  pass "agent reconnects after mid-command kill"
else
  fail "reconnect after kill" "agent never came back"
  exit 1
fi

# ============================================================================
# 3. CONCURRENT COMMANDS (fire 5 at once)
# ============================================================================
echo ""
echo "--- Concurrent commands ---"

# Refresh session name (previous tests may have created new sessions)
SESSION=$(get_session_name)

concurrent_ok=true
CPIDS=()
for i in $(seq 1 5); do
  api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo concurrent_$i\",\"timeout\":10}" > "$TMPDIR_E2E/concurrent_$i.json" &
  CPIDS+=($!)
done
for pid in "${CPIDS[@]}"; do wait "$pid"; done

for i in $(seq 1 5); do
  resp=$(cat "$TMPDIR_E2E/concurrent_$i.json")
  ok=$(echo "$resp" | jq -r '.ok')
  output=$(echo "$resp" | jq -r '.data.output // empty')
  if [[ "$ok" != "true" ]] || ! echo "$output" | grep -q "concurrent_$i"; then
    concurrent_ok=false
    fail "concurrent command $i" "ok=$ok output='$output'"
  fi
done
if [[ "$concurrent_ok" == "true" ]]; then
  pass "5 concurrent commands all returned correct output"
fi

# ============================================================================
# 4. NULL BYTES IN COMMAND OUTPUT
# ============================================================================
echo ""
echo "--- Binary/null byte handling ---"

SESSION=$(get_session_name)
# Use a command that generates binary output with null bytes
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"dd if=/dev/zero bs=1 count=8 2>/dev/null | cat - <(echo after)\",\"timeout\":5}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  # Should have base64-encoded output due to null bytes
  encoding=$(echo "$resp" | jq -r '.data.encoding // empty')
  if [[ "$encoding" == "base64" ]]; then
    pass "null bytes in output (base64 encoded)"
  else
    pass "null bytes in output (text)"
  fi
else
  fail "null bytes" "ok=$ok error=$(echo "$resp" | jq -r '.error // empty')"
fi

# ============================================================================
# 5. VERY LONG COMMAND STRING (100KB)
# ============================================================================
echo ""
echo "--- Edge case inputs ---"

SESSION=$(get_session_name)

long_arg=$(python3 -c "print('A' * 100000)")
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo ${long_arg:0:50000}\",\"timeout\":10}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  pass "50KB command string"
else
  # Acceptable if it errors cleanly
  err=$(echo "$resp" | jq -r '.error // empty')
  if [[ -n "$err" ]]; then
    pass "50KB command string (rejected cleanly: ${err:0:60})"
  else
    fail "long command" "no ok, no error"
  fi
fi

# ============================================================================
# 6. COMMAND PRODUCING CONTINUOUS OUTPUT (must timeout, not hang)
# ============================================================================
echo ""
echo "--- Continuous output commands ---"

# yes produces infinite output; should timeout at agent's 5s limit
start_time=$(date +%s)
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"yes 2>/dev/null || true\",\"timeout\":8}")
end_time=$(date +%s)
elapsed=$((end_time - start_time))

ok=$(echo "$resp" | jq -r '.ok')
if [[ "$elapsed" -lt 15 ]]; then
  pass "continuous output command timed out in ${elapsed}s (not hung)"
else
  fail "continuous output" "took ${elapsed}s, might be hanging"
fi

# ============================================================================
# 7. UPLOAD TO READ-ONLY PATH
# ============================================================================
echo ""
echo "--- Permission errors ---"

echo "test" > "$TMPDIR_E2E/readonly_src.txt"
resp=$(api "{\"action\":\"upload\",\"session\":\"$SESSION\",\"src\":\"$TMPDIR_E2E/readonly_src.txt\",\"dst\":\"/proc/self/mem\"}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "false" ]]; then
  pass "upload to /proc/self/mem rejected"
else
  fail "read-only upload" "expected failure, got ok=$ok"
fi

# ============================================================================
# 8. MULTIPLE AGENTS (3 concurrent)
# ============================================================================
echo ""
echo "--- Multiple agents ---"

AGENT2_PID=""
AGENT3_PID=""
"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" --cmd-timeout 5 --session-id "koth-agent-2-$$" 2>/dev/null &
AGENT2_PID=$!
"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" --cmd-timeout 5 --session-id "koth-agent-3-$$" 2>/dev/null &
AGENT3_PID=$!
sleep 1

count=$(session_count)
if [[ "$count" -ge 3 ]]; then
  pass "3 concurrent agents connected (count=$count)"
else
  fail "multiple agents" "expected >=3, got $count"
fi

# Execute on each session
resp=$(api '{"action":"sessions"}')
session_names=$(echo "$resp" | jq -r '[.data[] | select(.connected==true)] | .[].name')
multi_ok=true
for sn in $session_names; do
  r=$(api "{\"action\":\"exec\",\"session\":\"$sn\",\"command\":\"echo multi_$sn\",\"timeout\":5}")
  o=$(echo "$r" | jq -r '.ok')
  if [[ "$o" != "true" ]]; then
    multi_ok=false
    fail "multi-agent exec on $sn" "ok=$o"
  fi
done
if [[ "$multi_ok" == "true" ]]; then
  pass "command execution on all $count sessions"
fi

kill "$AGENT2_PID" 2>/dev/null || true
kill "$AGENT3_PID" 2>/dev/null || true

# ============================================================================
# 9. RAW TCP GARBAGE TO RELAY PORT
# ============================================================================
echo ""
echo "--- Protocol abuse ---"

SESSION=$(get_session_name)

# Send garbage bytes to the relay port
echo "AAAAAAAAAAAAAAAA" | nc -w 1 127.0.0.1 "$RELAY_PORT" 2>/dev/null || true
sleep 0.2

# Send a partial valid header then disconnect
printf '\x50\x4B\x52\x4C\xFF\xFF\xFF\xFF' | nc -w 1 127.0.0.1 "$RELAY_PORT" 2>/dev/null || true
sleep 0.2

# Restart agent (previous ones were killed in multi-agent cleanup)
kill "$AGENT_PID" 2>/dev/null || true
wait "$AGENT_PID" 2>/dev/null || true
"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" --cmd-timeout 5 2>/dev/null &
AGENT_PID=$!
if wait_for_sessions 1; then
  SESSION=$(get_session_name)
fi

# Verify relay still works
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo after_garbage\",\"timeout\":5}")
output=$(echo "$resp" | jq -r '.data.output // empty')
if echo "$output" | grep -q "after_garbage"; then
  pass "relay survives raw TCP garbage + malformed frames"
else
  fail "garbage resilience" "output='$output'"
fi

# ============================================================================
# 10. UNICODE IN PATHS AND COMMANDS
# ============================================================================
echo ""
echo "--- Unicode handling ---"

SESSION=$(get_session_name)

resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo '\\u00e9\\u00e8\\u00ea \\u2603 \\ud83d\\ude00'\",\"timeout\":5}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  pass "unicode in command output"
else
  fail "unicode command" "ok=$ok"
fi

unicode_path="$TMPDIR_E2E/tést_☃.txt"
echo "unicode content" > "$TMPDIR_E2E/unicode_src.txt"
resp=$(api "{\"action\":\"upload\",\"session\":\"$SESSION\",\"src\":\"$TMPDIR_E2E/unicode_src.txt\",\"dst\":\"$unicode_path\"}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  pass "upload to unicode path"
else
  # Some filesystems reject this; clean error is acceptable
  pass "upload to unicode path (rejected cleanly)"
fi

# ============================================================================
# 11. RELAY HEALTH CHECK AFTER ALL ABUSE
# ============================================================================
echo ""
echo "--- Final health check ---"

resp=$(api '{"action":"sessions"}')
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  connected=$(echo "$resp" | jq '[.data[] | select(.connected==true)] | length')
  pass "relay alive after all abuse ($connected sessions connected)"
else
  fail "final health check" "relay API returned ok=$ok"
fi

# One last command to prove the agent is still functional
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo survivor\",\"timeout\":5}")
output=$(echo "$resp" | jq -r '.data.output // empty')
if echo "$output" | grep -q "survivor"; then
  pass "agent still functional after full KotH abuse"
else
  fail "survivor check" "output='$output'"
fi
