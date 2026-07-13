# pk-orchestrator: Cartridge + pk CLI, NO attack tools.
# The orchestrator delegates; it does not run nmap, ffuf, or any offensive tool.

FROM cartridge:latest AS base

# Shell logger for command observability
COPY packages/scripts/shell-logger.sh /usr/local/bin/pk-shell-logger
RUN chmod +x /usr/local/bin/pk-shell-logger

# Bundle pk CLI + dependencies (Node.js and pnpm already in Cartridge base)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json /opt/pk/
COPY packages/core /opt/pk/packages/core
COPY packages/cli /opt/pk/packages/cli
COPY packages/supervisor /opt/pk/packages/supervisor
COPY packages/mcp-server /opt/pk/packages/mcp-server

WORKDIR /opt/pk
RUN pnpm install --frozen-lockfile && \
    pnpm --filter @promptkiddie/core build && \
    pnpm --filter @promptkiddie/cli build && \
    pnpm --filter @promptkiddie/supervisor build && \
    pnpm --filter @promptkiddie/mcp-server build && \
    pnpm prune --prod

# pk CLI wrapper
RUN printf '#!/bin/sh\nnode /opt/pk/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/pk && \
    chmod +x /usr/local/bin/pk

# pkx shortcut
COPY packages/cli/bin/pkx /usr/local/bin/pkx
RUN chmod +x /usr/local/bin/pkx

# Basic utilities + docker CLI (for pk spawn). No attack tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget jq openssh-client docker.io \
    && rm -rf /var/lib/apt/lists/*

# pk config directory (mounted at runtime)
RUN mkdir -p /etc/pk /workspace/.tool-log

WORKDIR /workspace
