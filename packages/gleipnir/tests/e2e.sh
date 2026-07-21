#!/usr/bin/env bash
set -euo pipefail

# E2E tests for gleipnir: builds locally, runs relay+agent, exercises the API.
# Run from packages/gleipnir/.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_PORT=24444
API_SOCK="/tmp/gleipnir-e2e-$$.sock"
RELAY_PID=""
AGENT_PID=""
PASS=0
FAIL=0
TMPDIR_E2E=$(mktemp -d)

cleanup() {
  [[ -n "$AGENT_PID" ]] && kill "$AGENT_PID" 2>/dev/null || true
  [[ -n "$RELAY_PID" ]] && kill "$RELAY_PID" 2>/dev/null || true
  rm -f "$API_SOCK"
  rm -rf "$TMPDIR_E2E"
  echo ""
  echo "=============================="
  echo "Results: $PASS passed, $FAIL failed"
  echo "=============================="
  if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
}
trap cleanup EXIT

# --- helpers ----------------------------------------------------------------

api() { python3 "$SCRIPT_DIR/api-client.py" "$API_SOCK" "$1"; }
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 -- $2"; }

assert_json_ok() {
  local resp="$1" label="$2"
  local ok
  ok=$(echo "$resp" | jq -r '.ok // false')
  if [[ "$ok" != "true" ]]; then
    local err
    err=$(echo "$resp" | jq -r '.error // "unknown"')
    fail "$label" "ok=false: $err"
    return 1
  fi
  return 0
}

wait_for_session() {
  local attempts=0
  while [[ $attempts -lt 30 ]]; do
    local resp
    resp=$(api '{"action":"sessions"}' 2>/dev/null || true)
    if [[ -n "$resp" ]]; then
      local count
      count=$(echo "$resp" | jq '.data | length' 2>/dev/null || echo 0)
      if [[ "$count" -gt 0 ]]; then
        return 0
      fi
    fi
    sleep 0.2
    attempts=$((attempts + 1))
  done
  return 1
}

get_session_name() {
  api '{"action":"sessions"}' | jq -r '.data[0].name'
}

# --- build ------------------------------------------------------------------

echo "=== Building gleipnir ==="
cargo build --release 2>&1 | tail -3

RELAY_BIN="target/release/gleipnir-server"
AGENT_BIN="target/release/gleipnir-agent"

if [[ ! -x "$RELAY_BIN" ]] || [[ ! -x "$AGENT_BIN" ]]; then
  echo "Build failed: missing binaries"
  exit 1
fi

# --- start relay + agent ----------------------------------------------------

echo ""
echo "=== Starting relay (port $RELAY_PORT, socket $API_SOCK) ==="
"$RELAY_BIN" --port "$RELAY_PORT" --api-socket "$API_SOCK" &
RELAY_PID=$!
sleep 0.3

echo "=== Starting agent ==="
"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" &
AGENT_PID=$!

echo "=== Waiting for session ==="
if ! wait_for_session; then
  echo "Agent never connected. Aborting."
  exit 1
fi

SESSION=$(get_session_name)
echo "  Session: $SESSION"
echo ""

# --- tests ------------------------------------------------------------------

echo "=== Running tests ==="

# 1. List sessions
resp=$(api '{"action":"sessions"}')
if assert_json_ok "$resp" "list sessions"; then
  count=$(echo "$resp" | jq '.data | length')
  if [[ "$count" -ge 1 ]]; then
    connected=$(echo "$resp" | jq -r '.data[0].connected')
    if [[ "$connected" == "true" ]]; then
      pass "list sessions (count=$count, connected=true)"
    else
      fail "list sessions" "session not connected"
    fi
  else
    fail "list sessions" "no sessions found"
  fi
fi

# 2. Execute echo
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo test123\",\"timeout\":10}")
if assert_json_ok "$resp" "exec echo"; then
  output=$(echo "$resp" | jq -r '.data.output')
  if echo "$output" | grep -q "test123"; then
    pass "exec echo"
  else
    fail "exec echo" "output='$output'"
  fi
fi

# 3. Execute uname
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"uname -a\",\"timeout\":10}")
if assert_json_ok "$resp" "exec uname"; then
  output=$(echo "$resp" | jq -r '.data.output')
  if [[ -n "$output" ]] && [[ "$output" != "null" ]]; then
    pass "exec uname (${output:0:40}...)"
  else
    fail "exec uname" "empty output"
  fi
fi

# 4. File transfer: upload then download, verify content matches
upload_content="gleipnir-e2e-test-$$-$(date +%s)"
upload_src="$TMPDIR_E2E/upload_src.txt"
remote_path="$TMPDIR_E2E/remote.txt"
download_dst="$TMPDIR_E2E/download_dst.txt"

echo -n "$upload_content" > "$upload_src"

resp=$(api "{\"action\":\"upload\",\"session\":\"$SESSION\",\"src\":\"$upload_src\",\"dst\":\"$remote_path\"}")
if assert_json_ok "$resp" "file upload"; then
  pass "file upload"
fi

resp=$(api "{\"action\":\"download\",\"session\":\"$SESSION\",\"src\":\"$remote_path\",\"dst\":\"$download_dst\"}")
if assert_json_ok "$resp" "file download"; then
  if [[ -f "$download_dst" ]]; then
    downloaded=$(cat "$download_dst")
    if [[ "$downloaded" == "$upload_content" ]]; then
      pass "file roundtrip (content matches)"
    else
      fail "file roundtrip" "content mismatch: got='$downloaded' expected='$upload_content'"
    fi
  else
    fail "file download" "file not written to $download_dst"
  fi
fi

# 5. Execute pwd
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"pwd\",\"timeout\":10}")
if assert_json_ok "$resp" "exec pwd"; then
  output=$(echo "$resp" | jq -r '.data.output' | tr -d '[:space:]')
  if [[ "$output" == /* ]]; then
    pass "exec pwd ($output)"
  else
    fail "exec pwd" "doesn't look like a path: '$output'"
  fi
fi

# 6. Session not found
resp=$(api '{"action":"exec","session":"nonexistent-session-xyz","command":"whoami","timeout":5}')
ok=$(echo "$resp" | jq -r '.ok // false')
if [[ "$ok" == "false" ]]; then
  err=$(echo "$resp" | jq -r '.error')
  if echo "$err" | grep -qi "not found"; then
    pass "session not found error"
  else
    fail "session not found" "unexpected error: $err"
  fi
else
  fail "session not found" "expected ok=false, got ok=true"
fi
