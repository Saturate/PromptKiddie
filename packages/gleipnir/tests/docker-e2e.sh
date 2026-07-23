#!/usr/bin/env bash
set -euo pipefail

# Docker E2E tests for gleipnir: builds the relay image, runs it in a container,
# builds the agent on the host, and exercises the API.
# Run from packages/gleipnir/.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAY_PORT=34444
CONTAINER_NAME="gleipnir-e2e-$$"
IMAGE_NAME="gleipnir-server-e2e"
API_SOCK="/tmp/gleipnir-docker-e2e-$$.sock"
AGENT_PID=""
PASS=0
FAIL=0
TMPDIR_E2E=$(mktemp -d)

cleanup() {
  [[ -n "$AGENT_PID" ]] && kill "$AGENT_PID" 2>/dev/null || true
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
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
  while [[ $attempts -lt 40 ]]; do
    local resp
    resp=$(api '{"action":"sessions"}' 2>/dev/null || true)
    if [[ -n "$resp" ]]; then
      local count
      count=$(echo "$resp" | jq '.data | length' 2>/dev/null || echo 0)
      if [[ "$count" -gt 0 ]]; then
        return 0
      fi
    fi
    sleep 0.3
    attempts=$((attempts + 1))
  done
  return 1
}

get_session_name() {
  api '{"action":"sessions"}' | jq -r '.data[0].name'
}

# --- preflight --------------------------------------------------------------

if ! command -v docker &>/dev/null; then
  echo "docker is required for docker-e2e tests."
  exit 1
fi

# --- build relay image ------------------------------------------------------

echo "=== Building relay Docker image ==="
docker build -t "$IMAGE_NAME" . 2>&1 | tail -5

# --- build agent locally ----------------------------------------------------

echo ""
echo "=== Building agent locally ==="
cargo build --release --bin gleipnir-agent 2>&1 | tail -3
AGENT_BIN="target/release/gleipnir-agent"

if [[ ! -x "$AGENT_BIN" ]]; then
  echo "Agent build failed."
  exit 1
fi

# --- start relay container --------------------------------------------------

SOCK_DIR=$(dirname "$API_SOCK")
SOCK_FILE=$(basename "$API_SOCK")

echo ""
echo "=== Starting relay container (port $RELAY_PORT) ==="
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "$RELAY_PORT:4444" \
  -v "$SOCK_DIR:/hostsock" \
  "$IMAGE_NAME" \
  --api-socket "/hostsock/$SOCK_FILE" \
  >/dev/null

# Wait for the socket to appear
attempts=0
while [[ ! -S "$API_SOCK" ]] && [[ $attempts -lt 30 ]]; do
  sleep 0.3
  attempts=$((attempts + 1))
done

if [[ ! -S "$API_SOCK" ]]; then
  echo "Relay socket never appeared. Container logs:"
  docker logs "$CONTAINER_NAME"
  exit 1
fi

echo "  Relay up (socket at $API_SOCK)"

# --- start agent on host ----------------------------------------------------

echo "=== Starting agent ==="
"$AGENT_BIN" -H 127.0.0.1 -p "$RELAY_PORT" &
AGENT_PID=$!

echo "=== Waiting for session ==="
if ! wait_for_session; then
  echo "Agent never connected. Container logs:"
  docker logs "$CONTAINER_NAME"
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
    pass "list sessions (count=$count)"
  else
    fail "list sessions" "no sessions"
  fi
fi

# 2. Exec echo
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"echo docker_test_ok\",\"timeout\":10}")
if assert_json_ok "$resp" "exec echo"; then
  output=$(echo "$resp" | jq -r '.data.output')
  if echo "$output" | grep -q "docker_test_ok"; then
    pass "exec echo"
  else
    fail "exec echo" "output='$output'"
  fi
fi

# 3. Exec uname
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"uname -a\",\"timeout\":10}")
if assert_json_ok "$resp" "exec uname"; then
  output=$(echo "$resp" | jq -r '.data.output')
  if [[ -n "$output" ]] && [[ "$output" != "null" ]]; then
    pass "exec uname"
  else
    fail "exec uname" "empty"
  fi
fi

# 4. File transfer roundtrip
upload_content="docker-e2e-$$"
upload_src="$TMPDIR_E2E/upload.txt"
remote_path="$TMPDIR_E2E/remote.txt"
download_dst="$TMPDIR_E2E/download.txt"
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
      pass "file roundtrip"
    else
      fail "file roundtrip" "mismatch"
    fi
  else
    fail "file download" "not written"
  fi
fi

# 5. Exec pwd
resp=$(api "{\"action\":\"exec\",\"session\":\"$SESSION\",\"command\":\"pwd\",\"timeout\":10}")
if assert_json_ok "$resp" "exec pwd"; then
  output=$(echo "$resp" | jq -r '.data.output' | tr -d '[:space:]')
  if [[ "$output" == /* ]]; then
    pass "exec pwd ($output)"
  else
    fail "exec pwd" "not a path: '$output'"
  fi
fi

# 6. Session not found
resp=$(api '{"action":"exec","session":"bogus-session","command":"id","timeout":5}')
ok=$(echo "$resp" | jq -r '.ok // false')
if [[ "$ok" == "false" ]]; then
  pass "session not found error"
else
  fail "session not found" "expected ok=false"
fi
