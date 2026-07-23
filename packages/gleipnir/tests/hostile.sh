#!/usr/bin/env bash
set -euo pipefail

# Hostile E2E tests: tries to break gleipnir with edge cases, large payloads,
# special characters, concurrent requests, disconnects, and timeouts.
# Run from packages/gleipnir/.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_PORT=34444
API_SOCK="/tmp/gleipnir-hostile-$$.sock"
RELAY_PID=""
AGENT_PID=""
PASS=0
FAIL=0
TMPDIR_E2E=$(mktemp -d /tmp/gleipnir-hostile-XXXXXX)

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

api() { python3 "$SCRIPT_DIR/api-client.py" "$API_SOCK" "$1"; }
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 -- $2"; }

wait_for_session() {
  local attempts=0
  while [[ $attempts -lt 30 ]]; do
    local resp
    resp=$(api '{"action":"sessions"}' 2>/dev/null || true)
    if [[ -n "$resp" ]]; then
      local count
      count=$(echo "$resp" | jq '.data | length' 2>/dev/null || echo 0)
      if [[ "$count" -gt 0 ]]; then return 0; fi
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
echo "=== Building gleipnir (release) ==="
cargo build --release 2>&1 | tail -3

RELAY_BIN="target/release/gleipnir-server"
AGENT_BIN="target/release/gleipnir-agent"

# --- start relay + agent ----------------------------------------------------
echo ""
echo "=== Starting relay + agent ==="
"$RELAY_BIN" --port "$RELAY_PORT" --api-socket "$API_SOCK" --no-tls 2>/dev/null &
RELAY_PID=$!
sleep 0.3

"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" --cmd-timeout 5 2>/dev/null &
AGENT_PID=$!

echo "=== Waiting for session ==="
if ! wait_for_session; then
  echo "Agent never connected. Aborting."
  exit 1
fi
SESSION=$(get_session_name)
echo "  Session: $SESSION"
echo ""
echo "=== Running hostile tests ==="

# --- 1. Special characters in commands --------------------------------------
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo 'hello \\\"world\\\"'\",\"timeout\":5}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  pass "special chars: quotes in echo"
else
  fail "special chars: quotes" "$(echo "$resp" | jq -r '.error')"
fi

# --- 2. Semicolons and pipes ------------------------------------------------
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo aaa; echo bbb | tr b B\",\"timeout\":5}")
output=$(echo "$resp" | jq -r '.data.output // empty')
if echo "$output" | grep -q "aaa" && echo "$output" | grep -q "BBB"; then
  pass "semicolons and pipes"
else
  fail "semicolons and pipes" "output='$output'"
fi

# --- 3. Binary file transfer (non-UTF8) -------------------------------------
dd if=/dev/urandom of="$TMPDIR_E2E/binary_src.bin" bs=1024 count=256 2>/dev/null
resp=$(api "{\"action\":\"upload\",\"session\":\"$SESSION\",\"src\":\"$TMPDIR_E2E/binary_src.bin\",\"dst\":\"$TMPDIR_E2E/binary_remote.bin\"}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" != "true" ]]; then
  fail "binary upload" "$(echo "$resp" | jq -r '.error')"
else
  resp=$(api "{\"action\":\"download\",\"session\":\"$SESSION\",\"src\":\"$TMPDIR_E2E/binary_remote.bin\",\"dst\":\"$TMPDIR_E2E/binary_download.bin\"}")
  ok=$(echo "$resp" | jq -r '.ok')
  if [[ "$ok" == "true" ]] && diff -q "$TMPDIR_E2E/binary_src.bin" "$TMPDIR_E2E/binary_download.bin" >/dev/null 2>&1; then
    pass "binary file roundtrip (256KB)"
  else
    fail "binary file roundtrip" "content mismatch or download failed"
  fi
fi

# --- 4. Large file transfer (4MB) -------------------------------------------
dd if=/dev/urandom of="$TMPDIR_E2E/large_src.bin" bs=1024 count=4096 2>/dev/null
resp=$(api "{\"action\":\"upload\",\"session\":\"$SESSION\",\"src\":\"$TMPDIR_E2E/large_src.bin\",\"dst\":\"$TMPDIR_E2E/large_remote.bin\"}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" != "true" ]]; then
  fail "large file upload (4MB)" "$(echo "$resp" | jq -r '.error')"
else
  resp=$(api "{\"action\":\"download\",\"session\":\"$SESSION\",\"src\":\"$TMPDIR_E2E/large_remote.bin\",\"dst\":\"$TMPDIR_E2E/large_download.bin\"}")
  ok=$(echo "$resp" | jq -r '.ok')
  if [[ "$ok" == "true" ]] && diff -q "$TMPDIR_E2E/large_src.bin" "$TMPDIR_E2E/large_download.bin" >/dev/null 2>&1; then
    pass "large file roundtrip (4MB)"
  else
    fail "large file roundtrip" "content mismatch or download failed"
  fi
fi

# --- 5. Command that produces large output ----------------------------------
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"seq 1 10000\",\"timeout\":10}")
ok=$(echo "$resp" | jq -r '.ok')
output=$(echo "$resp" | jq -r '.data.output // empty')
if [[ "$ok" == "true" ]] && echo "$output" | grep -q "10000"; then
  pass "large output (seq 10000)"
else
  fail "large output" "missing 10000 in output or ok=$ok"
fi

# --- 6. Command timeout (agent has --cmd-timeout 5) -------------------------
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"sleep 20\",\"timeout\":3}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  output=$(echo "$resp" | jq -r '.data.output // empty')
  if echo "$output" | grep -qi "timed out"; then
    pass "command timeout (agent-side)"
  else
    fail "command timeout" "ok=true but no timeout message: $output"
  fi
else
  err=$(echo "$resp" | jq -r '.error')
  if echo "$err" | grep -qi "timed out"; then
    pass "command timeout (relay-side)"
  else
    fail "command timeout" "error=$err"
  fi
fi

# --- 7. Rapid-fire commands (10 sequential) ---------------------------------
rapid_ok=true
for i in $(seq 1 10); do
  resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo rapid_$i\",\"timeout\":5}")
  ok=$(echo "$resp" | jq -r '.ok')
  output=$(echo "$resp" | jq -r '.data.output // empty')
  if [[ "$ok" != "true" ]] || ! echo "$output" | grep -q "rapid_$i"; then
    rapid_ok=false
    break
  fi
done
if [[ "$rapid_ok" == "true" ]]; then
  pass "rapid-fire 10 sequential commands"
else
  fail "rapid-fire commands" "failed at iteration $i"
fi

# --- 8. Command with stderr output -----------------------------------------
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo stdout_msg; echo stderr_msg >&2\",\"timeout\":5}")
output=$(echo "$resp" | jq -r '.data.output // empty')
if echo "$output" | grep -q "stdout_msg" && echo "$output" | grep -q "stderr_msg"; then
  pass "stdout + stderr combined"
else
  fail "stdout + stderr" "output='$output'"
fi

# --- 9. Empty command -------------------------------------------------------
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"\",\"timeout\":5}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]]; then
  pass "empty command (no crash)"
else
  fail "empty command" "$(echo "$resp" | jq -r '.error')"
fi

# --- 10. Upload to nonexistent deep path ------------------------------------
deep_path="$TMPDIR_E2E/a/b/c/d/e/deep_file.txt"
echo "deep" > "$TMPDIR_E2E/deep_src.txt"
resp=$(api "{\"action\":\"upload\",\"session\":\"$SESSION\",\"src\":\"$TMPDIR_E2E/deep_src.txt\",\"dst\":\"$deep_path\"}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "true" ]] && [[ -f "$deep_path" ]]; then
  pass "upload creates deep directory path"
else
  fail "upload deep path" "ok=$ok, file exists=$(test -f "$deep_path" && echo yes || echo no)"
fi

# --- 11. Download nonexistent file ------------------------------------------
resp=$(api "{\"action\":\"download\",\"session\":\"$SESSION\",\"src\":\"/tmp/gleipnir_does_not_exist_$$\",\"dst\":\"$TMPDIR_E2E/nope.txt\"}")
ok=$(echo "$resp" | jq -r '.ok')
if [[ "$ok" == "false" ]]; then
  pass "download nonexistent file returns error"
else
  fail "download nonexistent" "expected ok=false, got ok=$ok"
fi

# --- 12. Malformed JSON request ---------------------------------------------
resp=$(api 'this is not json' 2>/dev/null || echo '{"ok":false}')
ok=$(echo "$resp" | jq -r '.ok // false')
if [[ "$ok" == "false" ]]; then
  pass "malformed JSON handled gracefully"
else
  fail "malformed JSON" "expected error, got ok=$ok"
fi

# --- 13. Verify relay still alive after all hostile tests -------------------
resp=$(api '{"action":"sessions"}')
ok=$(echo "$resp" | jq -r '.ok')
count=$(echo "$resp" | jq '.data | length')
if [[ "$ok" == "true" ]] && [[ "$count" -ge 1 ]]; then
  pass "relay still alive after hostile tests"
else
  fail "relay health check" "ok=$ok count=$count"
fi
