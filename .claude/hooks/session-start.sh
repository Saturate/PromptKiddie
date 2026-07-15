#!/usr/bin/env bash
# SessionStart hook: prepare the PromptKiddie workspace for a Claude Code session.
# Best-effort and non-fatal — prints status so the orchestrator knows what's ready.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 0

echo "[promptkiddie] preparing workspace…"

# Ensure .env exists so DATABASE_URL is available.
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[promptkiddie] created .env from .env.example (edit secrets before real use)"
fi

# Install JS deps if missing.
if [ ! -d node_modules ]; then
  if command -v pnpm >/dev/null 2>&1; then
    echo "[promptkiddie] installing deps with pnpm…"
    pnpm install --silent || echo "[promptkiddie] pnpm install failed (run manually)"
  else
    echo "[promptkiddie] pnpm not found — install it to use the pk CLI / DB tooling"
  fi
fi

# Bring Postgres up if Docker is available.
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d postgres >/dev/null 2>&1 \
      && echo "[promptkiddie] postgres is up" \
      || echo "[promptkiddie] could not start postgres (start it with: docker compose up -d)"
  fi
else
  echo "[promptkiddie] docker not found; start Postgres yourself, then: pnpm db:push"
fi

# Build and run migrations so pk + schema are ready.
if command -v pnpm >/dev/null 2>&1; then
  # --silent must precede the script name; pnpm forwards trailing args to the
  # underlying command (tsc/drizzle-kit), which reject an unknown --silent flag.
  pnpm --silent build 2>/dev/null || true
  pnpm --silent db:migrate 2>/dev/null \
    && echo "[promptkiddie] migrations applied" \
    || true
  # Apply custom SQL migrations (LISTEN/NOTIFY triggers, column additions, etc.)
  DB_CONTAINER=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^(pk-db|promptkiddie-db)$' | head -1)
  for f in db/migrations/0*.sql; do
    [ -n "$DB_CONTAINER" ] && [ -f "$f" ] && docker exec -i "$DB_CONTAINER" psql -U "${POSTGRES_USER:-promptkiddie}" \
      -d "${POSTGRES_DB:-promptkiddie}" < "$f" 2>/dev/null || true
  done
fi

# v2 doesn't need a separate tooling container (tools are in agent containers).
# Start infrastructure services if not running.
if command -v docker >/dev/null 2>&1; then
  if ! docker ps --format '{{.Names}}' | grep -qE '^(pk-db|promptkiddie-db)$'; then
    docker compose up -d postgres >/dev/null 2>&1 || true
  fi
fi

# Check for active engagements and ensure supervisor is running.
if command -v pnpm >/dev/null 2>&1; then
  ACTIVE=$(pnpm --silent pk engagement list 2>/dev/null \
    | jq -r '.[] | select(.status == "active") | "\(.id) \(.name)"' 2>/dev/null | head -1)
  if [ -n "$ACTIVE" ]; then
    EID=$(echo "$ACTIVE" | cut -d' ' -f1)
    ENAME=$(echo "$ACTIVE" | cut -d' ' -f2-)
    echo "[promptkiddie] active engagement: $ENAME ($EID)"
    if pgrep -f "pk supervisor" >/dev/null 2>&1; then
      echo "[promptkiddie] supervisor already running"
    else
      echo "[promptkiddie] start supervisor with: pk supervisor --standby"
    fi
  fi
fi

# Reset inline command counter from previous sessions.
rm -f /tmp/.pk-inline-cmd-count

echo "[promptkiddie] ready. See CLAUDE.md for orchestrator instructions."
exit 0
