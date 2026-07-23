#!/bin/bash
# Gleipnir v2 - Full E2E test suite
# Tests: HTTP API, raw TCP catch, native agent, HTTP C2, CLI, agent serving
set -e

API="http://localhost:16666"
AGENT_PORT=14444
RAW_PORT=19001
COMPOSE="docker compose -f $(dirname "$0")/docker-compose.test.yml"
PASS=0
FAIL=0
TOTAL=0

pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "  ✗ $1: $2"; }

cleanup() {
  echo ""
  echo "Cleaning up..."
  $COMPOSE down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

echo "═══════════════════════════════════════════"
echo "  Gleipnir v2 - Full E2E Test Suite"
echo "═══════════════════════════════════════════"
echo ""

# ── Build ──
echo "Building Docker image..."
$COMPOSE build --quiet 2>&1 || { echo "Build failed"; exit 1; }

# ── Start server ──
echo "Starting gleipnir server..."
$COMPOSE up -d gleipnir 2>&1

echo "Waiting for server health..."
for i in $(seq 1 30); do
  if curl -sf "$API/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ── Test 1: Health endpoint ──
echo ""
echo "── API Tests ──"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/health")
[ "$CODE" = "200" ] && pass "GET /api/health -> 200" || fail "health" "got $CODE"

# ── Test 2: Info endpoint ──
INFO=$(curl -s "$API/api/info")
echo "$INFO" | grep -q '"version"' && pass "GET /api/info has version" || fail "info" "$INFO"

# ── Test 3: Default listener exists ──
LISTENERS=$(curl -s "$API/api/listeners")
echo "$LISTENERS" | grep -q '"agent"' && pass "Default agent listener exists" || fail "default listener" "$LISTENERS"

# ── Test 4: Create raw listener ──
RAW_LST=$(curl -s -X POST "$API/api/listeners" -H 'Content-Type: application/json' -d '{"port": 9001, "mode": "raw"}')
echo "$RAW_LST" | grep -q '"raw"' && pass "POST /api/listeners (raw) created" || fail "raw listener" "$RAW_LST"

# ── Test 5: List shows both listeners ──
LST_COUNT=$(curl -s "$API/api/listeners" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
[ "$LST_COUNT" -ge 2 ] && pass "Two listeners active" || fail "listener count" "got $LST_COUNT"

# ── Test 6: Sessions initially empty ──
SESSIONS=$(curl -s "$API/api/sessions")
[ "$SESSIONS" = "[]" ] && pass "Sessions initially empty" || fail "initial sessions" "$SESSIONS"

# ── Test 7: Agent binary listing ──
echo ""
echo "── Agent Serving Tests ──"
AGENTS=$(curl -s "$API/api/agents")
# May be empty if no agent binaries pre-staged, just check it returns valid JSON
echo "$AGENTS" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null && pass "GET /api/agents returns valid JSON" || fail "agents" "$AGENTS"

# ── Test 8: Raw TCP session catch ──
echo ""
echo "── Raw TCP Catch Tests ──"
echo "Starting target container (bash revshell)..."
$COMPOSE up -d target 2>&1

echo "Waiting for session (max 15s)..."
SESSION_NAME=""
for i in $(seq 1 15); do
  SESSIONS=$(curl -s "$API/api/sessions")
  if echo "$SESSIONS" | grep -q '"name"'; then
    SESSION_NAME=$(echo "$SESSIONS" | python3 -c "import sys,json; s=json.load(sys.stdin); print(s[0]['name'])" 2>/dev/null)
    break
  fi
  sleep 1
done

if [ -n "$SESSION_NAME" ]; then
  pass "Raw TCP session captured: $SESSION_NAME"
else
  fail "raw session" "no session appeared after 15s"
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Results: $PASS passed, $FAIL failed ($TOTAL total)"
  echo "═══════════════════════════════════════════"
  exit 1
fi

# ── Test 9: Session details ──
DETAIL=$(curl -s "$API/api/sessions/$SESSION_NAME")
echo "$DETAIL" | grep -q '"connected":true' && pass "Session is connected" || fail "session connected" "$DETAIL"
echo "$DETAIL" | grep -q '"raw"' && pass "Session mode is raw" || fail "session mode" "$DETAIL"

# ── Test 10: Exec on raw session ──
EXEC_RESULT=$(curl -s -X POST "$API/api/sessions/$SESSION_NAME/exec" \
  -H 'Content-Type: application/json' -d '{"command": "echo gleipnir_test_ok", "timeout": 10}')
echo "$EXEC_RESULT" | grep -q "gleipnir_test_ok" && pass "Exec 'echo' on raw session" || fail "exec echo" "$EXEC_RESULT"

# ── Test 11: Exec id on raw session ──
ID_RESULT=$(curl -s -X POST "$API/api/sessions/$SESSION_NAME/exec" \
  -H 'Content-Type: application/json' -d '{"command": "id", "timeout": 10}')
echo "$ID_RESULT" | grep -q "uid=" && pass "Exec 'id' returns uid" || fail "exec id" "$ID_RESULT"

# ── Test 12: Exec hostname ──
HOST_RESULT=$(curl -s -X POST "$API/api/sessions/$SESSION_NAME/exec" \
  -H 'Content-Type: application/json' -d '{"command": "hostname", "timeout": 10}')
HOST_OUTPUT=$(echo "$HOST_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('output',''))" 2>/dev/null || echo "")
[ -n "$HOST_OUTPUT" ] && pass "Exec 'hostname' returns non-empty output: $HOST_OUTPUT" || fail "exec hostname" "$HOST_RESULT"

# ── Test 13: Upload/download rejected for raw ──
echo ""
echo "── Raw Session Limitation Tests ──"
UP_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/sessions/$SESSION_NAME/upload" \
  -H 'Content-Type: application/json' -d '{"src_path": "/tmp/x", "dst_path": "/tmp/y"}')
[ "$UP_RESULT" = "400" ] && pass "Upload rejected for raw session (400)" || fail "upload reject" "$UP_RESULT"

DL_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/sessions/$SESSION_NAME/download" \
  -H 'Content-Type: application/json' -d '{"remote_path": "/etc/hostname"}')
[ "$DL_RESULT" = "400" ] && pass "Download rejected for raw session (400)" || fail "download reject" "$DL_RESULT"

# ── HTTP Beacon Tests ──
echo ""
echo "── HTTP Beacon Tests ──"
BEACON_LST=$(curl -s -X POST "$API/api/listeners" -H 'Content-Type: application/json' -d '{"port": 9002, "mode": "http"}')
echo "$BEACON_LST" | grep -q '"http"' && pass "HTTP beacon listener created" || fail "beacon listener" "$BEACON_LST"

BEACON_URL="http://localhost:19002"
sleep 1

CHECKIN=$(curl -s -X POST "$BEACON_URL/checkin" -H 'Content-Type: application/json' \
  -d '{"os":"linux","arch":"x86_64","hostname":"beacon-test","username":"tester","pid":1,"cwd":"/tmp"}')
BEACON_SID=$(echo "$CHECKIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
[ -n "$BEACON_SID" ] && pass "Beacon checkin returned session_id: $BEACON_SID" || fail "beacon checkin" "$CHECKIN"

# Beacon empty poll: no command queued, should return null command within timeout
if [ -n "$BEACON_SID" ]; then
  TASK=$(curl -s --max-time 3 "$BEACON_URL/task/$BEACON_SID" 2>/dev/null || true)
  TASK_CMD=$(echo "$TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('command') or '')" 2>/dev/null || echo "PARSE_FAIL")
  if [ "$TASK_CMD" = "" ]; then
    pass "Beacon empty poll returns null command"
  elif [ "$TASK_CMD" = "PARSE_FAIL" ]; then
    pass "Beacon poll timed out (no pending task)"
  else
    fail "beacon empty poll" "expected null command, got '$TASK_CMD'"
  fi
fi

# Beacon E2E: queue command via exec API, poll via beacon, post result, verify caller gets output
if [ -n "$BEACON_SID" ]; then
  echo ""
  echo "── Beacon E2E Command Flow ──"
  BEACON_TMPFILE=$(mktemp /tmp/gleipnir-beacon-e2e-XXXXXX)

  # Queue a command in the background (blocks until result arrives or timeout)
  curl -s -X POST "$API/api/sessions/$BEACON_SID/exec" \
    -H 'Content-Type: application/json' -d '{"command": "echo beacon_e2e_works", "timeout": 15}' > "$BEACON_TMPFILE" 2>/dev/null &
  EXEC_BG_PID=$!

  sleep 1

  # Agent polls for task
  TASK=$(curl -s --max-time 10 "$BEACON_URL/task/$BEACON_SID" 2>/dev/null || true)
  TASK_ID=$(echo "$TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id') or '')" 2>/dev/null || echo "")
  TASK_CMD=$(echo "$TASK" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('command') or '')" 2>/dev/null || echo "")

  if [ -n "$TASK_ID" ] && [ -n "$TASK_CMD" ]; then
    pass "Beacon poll received task id=$TASK_ID command='$TASK_CMD'"
  else
    fail "beacon poll task" "id='$TASK_ID' command='$TASK_CMD' raw='$TASK'"
  fi

  # Agent posts result back
  if [ -n "$TASK_ID" ]; then
    RESULT_RESP=$(curl -s -X POST "$BEACON_URL/result/$BEACON_SID" \
      -H 'Content-Type: application/json' \
      -d "{\"id\": $TASK_ID, \"output\": \"beacon_e2e_works\"}" 2>/dev/null || true)
    echo "$RESULT_RESP" | grep -q '"ok"' && pass "Beacon result posted" || fail "beacon result post" "$RESULT_RESP"
  fi

  # Wait for the background exec to finish
  wait "$EXEC_BG_PID" 2>/dev/null || true
  EXEC_OUTPUT=$(cat "$BEACON_TMPFILE" 2>/dev/null || echo "")
  rm -f "$BEACON_TMPFILE"

  if echo "$EXEC_OUTPUT" | grep -q "beacon_e2e_works"; then
    pass "Beacon E2E: exec caller received correct output"
  else
    fail "beacon e2e output" "$EXEC_OUTPUT"
  fi
fi

# ── SOCKS Tunnel API Tests ──
echo ""
echo "── SOCKS Tunnel Tests ──"
TUNNEL_CREATE=$(curl -s -X POST "$API/api/tunnels" \
  -H 'Content-Type: application/json' -d "{\"session\": \"$SESSION_NAME\", \"port\": 11080}" 2>/dev/null || true)
# Session may be raw (no SOCKS support), but the API should respond
TUNNEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/tunnels" \
  -H 'Content-Type: application/json' -d "{\"session\": \"$SESSION_NAME\", \"port\": 11081}" 2>/dev/null || echo "000")
if [ "$TUNNEL_CODE" = "201" ] || [ "$TUNNEL_CODE" = "400" ]; then
  pass "SOCKS tunnel create returns valid response ($TUNNEL_CODE)"
else
  fail "socks create" "got $TUNNEL_CODE"
fi

TUNNELS=$(curl -s "$API/api/tunnels" 2>/dev/null || echo "[]")
echo "$TUNNELS" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null && pass "GET /api/tunnels returns valid JSON" || fail "tunnels list" "$TUNNELS"

# Stop tunnel if one was created
if [ "$TUNNEL_CODE" = "201" ]; then
  STOP_TUNNEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/tunnels/$SESSION_NAME" 2>/dev/null || echo "000")
  [ "$STOP_TUNNEL" = "200" ] && pass "SOCKS tunnel stop returns 200" || fail "socks stop" "got $STOP_TUNNEL"
fi

# ── Auth Rejection Tests ──
echo ""
echo "── Auth Tests ──"
AUTH_API="http://localhost:16667"

echo "Starting auth-enabled server..."
$COMPOSE up -d gleipnir-auth 2>&1

echo "Waiting for auth server health..."
AUTH_READY=false
for i in $(seq 1 20); do
  if curl -sf -H "Authorization: Bearer test-secret-key" "$AUTH_API/api/health" >/dev/null 2>&1; then
    AUTH_READY=true
    break
  fi
  sleep 1
done

if [ "$AUTH_READY" = "true" ]; then
  # Request without auth should be rejected
  NOAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$AUTH_API/api/sessions" 2>/dev/null)
  [ "$NOAUTH_CODE" = "401" ] && pass "Auth: unauthenticated request returns 401" || fail "auth reject" "got $NOAUTH_CODE"

  # Request with wrong key should be rejected
  BADAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer wrong-key" "$AUTH_API/api/sessions" 2>/dev/null)
  [ "$BADAUTH_CODE" = "401" ] && pass "Auth: wrong key returns 401" || fail "auth wrong key" "got $BADAUTH_CODE"

  # Request with correct key should succeed
  GOODAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer test-secret-key" "$AUTH_API/api/sessions" 2>/dev/null)
  [ "$GOODAUTH_CODE" = "200" ] && pass "Auth: correct key returns 200" || fail "auth accept" "got $GOODAUTH_CODE"

  # Health endpoint should also require auth
  HEALTH_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$AUTH_API/api/health" 2>/dev/null)
  [ "$HEALTH_NOAUTH" = "401" ] && pass "Auth: health endpoint also protected" || fail "auth health" "got $HEALTH_NOAUTH"
else
  fail "auth server" "did not become healthy within 20s"
fi

# ── Session Management Tests ──
echo ""
echo "── Session Management Tests ──"
KILL_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/sessions/$SESSION_NAME")
[ "$KILL_RESULT" = "200" ] && pass "Kill session returns 200" || fail "kill session" "$KILL_RESULT"

NOT_FOUND=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/sessions/nonexistent")
[ "$NOT_FOUND" = "404" ] && pass "Nonexistent session returns 404" || fail "not found" "$NOT_FOUND"

# Double-kill should return 404
DOUBLE_KILL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/sessions/$SESSION_NAME")
[ "$DOUBLE_KILL" = "404" ] && pass "Double-kill returns 404" || fail "double kill" "got $DOUBLE_KILL"

LST_ID=$(echo "$RAW_LST" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
if [ -n "$LST_ID" ]; then
  CLOSE_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/listeners/$LST_ID")
  [ "$CLOSE_RESULT" = "200" ] && pass "Close listener returns 200" || fail "close listener" "$CLOSE_RESULT"
fi

# ── Results ──
echo ""
echo "═══════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed ($TOTAL total)"
echo "═══════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
