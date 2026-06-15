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
  echo "[promptkiddie] docker not found — start Postgres yourself, then: pnpm db:push"
fi

echo "[promptkiddie] ready. See CLAUDE.md for orchestrator instructions."
exit 0
