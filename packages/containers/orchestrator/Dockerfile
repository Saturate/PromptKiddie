# pk-orchestrator: Cartridge + pk CLI, NO attack tools.
# The orchestrator manages engagements; it does not run offensive tools directly.
# Instructions are loaded from ORCHESTRATOR.md which can be overridden per event.
#
# Build: pnpm build && docker build -t pk-orchestrator -f packages/containers/orchestrator/Dockerfile .

FROM cartridge:latest AS base

# Shell logger for command observability
COPY packages/scripts/shell-logger.sh /usr/local/bin/pk-shell-logger
RUN chmod +x /usr/local/bin/pk-shell-logger

# Bundle pk CLI + dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json /opt/pk/
COPY packages/core /opt/pk/packages/core
COPY packages/cli /opt/pk/packages/cli
COPY packages/daemon /opt/pk/packages/daemon
COPY packages/mcp-server /opt/pk/packages/mcp-server

WORKDIR /opt/pk
RUN pnpm install --frozen-lockfile && \
    pnpm --filter @promptkiddie/core build && \
    pnpm --filter @promptkiddie/cli build && \
    pnpm --filter @promptkiddie/daemon build && \
    pnpm --filter @promptkiddie/mcp-server build && \
    pnpm prune --prod

# pk CLI wrapper
RUN printf '#!/bin/sh\nnode /opt/pk/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/pk && \
    chmod +x /usr/local/bin/pk

# pkx shortcut
COPY packages/cli/bin/pkx /usr/local/bin/pkx
RUN chmod +x /usr/local/bin/pkx

# Basic utilities + docker CLI (for spawning containers). No attack tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget jq openssh-client docker.io \
    && rm -rf /var/lib/apt/lists/*

# pk config directory
RUN mkdir -p /etc/pk /workspace/.tool-log

# Default orchestrator instructions (can be overridden by mounting a custom file)
COPY packages/containers/orchestrator/ORCHESTRATOR.md /workspace/ORCHESTRATOR.md
RUN ln -sf ORCHESTRATOR.md /workspace/CLAUDE.md

# Entrypoint: starts daemon in standby, then delegates to Cartridge
COPY packages/containers/orchestrator/entrypoint.sh /usr/local/bin/pk-entrypoint
RUN chmod +x /usr/local/bin/pk-entrypoint

WORKDIR /workspace
ENTRYPOINT ["pk-entrypoint"]
