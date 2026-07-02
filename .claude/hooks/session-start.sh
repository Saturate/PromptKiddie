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
  # Apply custom migrations (LISTEN/NOTIFY triggers etc.)
  for f in db/migrations/0001_*.sql db/migrations/0002_*.sql; do
    [ -f "$f" ] && docker exec -i promptkiddie-db psql -U "${POSTGRES_USER:-promptkiddie}" \
      -d "${POSTGRES_DB:-promptkiddie}" < "$f" 2>/dev/null || true
  done
fi

# Start the tooling container if not running.
if command -v docker >/dev/null 2>&1; then
  if ! docker ps --format '{{.Names}}' | grep -q promptkiddie-tooling; then
    docker compose up -d tooling >/dev/null 2>&1 \
      && echo "[promptkiddie] tooling container is up" \
      || true
  fi
fi

echo "[promptkiddie] ready. See CLAUDE.md for orchestrator instructions."
exit 0
