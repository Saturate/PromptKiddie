#!/bin/sh
# Set CLAUDE.md symlink based on PK_ROLE env var.
# Called by the container entrypoint or manually.
case "${PK_ROLE}" in
  orchestrator)
    ln -sf ORCHESTRATOR.md /workspace/CLAUDE.md
    echo "[pk-role] orchestrator mode"
    ;;
  supervisor)
    ln -sf SUPERVISOR.md /workspace/CLAUDE.md
    echo "[pk-role] supervisor mode"
    ;;
  *)
    ln -sf AGENT.md /workspace/CLAUDE.md
    ;;
esac
