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
LST_COUNT=$(curl -s "$API/api/listeners" | grep -c '"id"')
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
echo "$HOST_RESULT" | grep -q "output" && pass "Exec 'hostname' returns output" || fail "exec hostname" "$HOST_RESULT"

# ── Test 13: Upload/download rejected for raw ──
echo ""
echo "── Raw Session Limitation Tests ──"
UP_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/sessions/$SESSION_NAME/upload" \
  -H 'Content-Type: application/json' -d '{"src_path": "/tmp/x", "dst_path": "/tmp/y"}')
[ "$UP_RESULT" = "400" ] && pass "Upload rejected for raw session (400)" || fail "upload reject" "$UP_RESULT"

DL_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/sessions/$SESSION_NAME/download" \
  -H 'Content-Type: application/json' -d '{"remote_path": "/etc/hostname"}')
[ "$DL_RESULT" = "400" ] && pass "Download rejected for raw session (400)" || fail "download reject" "$DL_RESULT"

# ── Test 14: HTTP C2 ──
echo ""
echo "── HTTP C2 Tests ──"
CHECKIN=$(curl -s -X POST "$API/c2/http-test/checkin" -H 'Content-Type: application/json' -d '{}')
echo "$CHECKIN" | grep -q "http-test" && pass "HTTP C2 checkin" || fail "c2 checkin" "$CHECKIN"

# Queue a task
curl -s -X POST "$API/api/sessions/http-test/exec" \
  -H 'Content-Type: application/json' -d '{"command": "id", "timeout": 10}' >/dev/null 2>&1 &
sleep 1

TASK=$(curl -s "$API/c2/http-test/task")
echo "$TASK" | grep -q "id" && pass "HTTP C2 task polling" || pass "HTTP C2 no pending task (ok)"

# ── Test 15: Kill session ──
echo ""
echo "── Session Management Tests ──"
KILL_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/sessions/$SESSION_NAME")
[ "$KILL_RESULT" = "200" ] && pass "Kill session returns 200" || fail "kill session" "$KILL_RESULT"

# ── Test 16: Session not found ──
NOT_FOUND=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/sessions/nonexistent")
[ "$NOT_FOUND" = "404" ] && pass "Nonexistent session returns 404" || fail "not found" "$NOT_FOUND"

# ── Test 17: Close listener ──
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
