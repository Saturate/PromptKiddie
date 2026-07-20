#!/bin/sh
# Set CLAUDE.md symlink based on PK_ROLE env var.
# Called by the container entrypoint or manually.
case "${PK_ROLE}" in
  orchestrator)
    ln -sf ORCHESTRATOR.md /workspace/CLAUDE.md
    echo "[pk-role] orchestrator mode"
    ;;
  *)
    ln -sf AGENT.md /workspace/CLAUDE.md
    ;;
esac
