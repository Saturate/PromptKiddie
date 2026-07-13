# pk-agent: Cartridge + pk + attack tools. Models run commands directly.
# Multi-stage: recon, attack, full. Build with --target <stage>.
#
#   docker build --target recon -t pk-agent-recon .
#   docker build --target attack -t pk-agent-attack .
#   docker build --target full -t pk-agent-full .

# ── Stage 0: pk bundle (shared across all variants) ─────────────────
FROM cartridge:latest AS base

# Shell logger (installed now, activated as SHELL after all build RUNs)
COPY packages/scripts/shell-logger.sh /usr/local/bin/pk-shell-logger
RUN chmod +x /usr/local/bin/pk-shell-logger

# Node.js for TypeScript pk
RUN if ! command -v node >/dev/null 2>&1; then \
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
      apt-get install -y --no-install-recommends nodejs && \
      rm -rf /var/lib/apt/lists/*; \
    fi

# Bundle pk CLI
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /opt/pk/
COPY packages/core /opt/pk/packages/core
COPY packages/cli /opt/pk/packages/cli
COPY packages/supervisor /opt/pk/packages/supervisor
COPY packages/mcp-server /opt/pk/packages/mcp-server

WORKDIR /opt/pk
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install --frozen-lockfile --prod && \
    pnpm --filter @promptkiddie/core build && \
    pnpm --filter @promptkiddie/cli build && \
    pnpm --filter @promptkiddie/supervisor build && \
    pnpm --filter @promptkiddie/mcp-server build

RUN printf '#!/bin/sh\nnode /opt/pk/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/pk && \
    chmod +x /usr/local/bin/pk
COPY packages/cli/bin/pkx /usr/local/bin/pkx
RUN chmod +x /usr/local/bin/pkx

RUN mkdir -p /etc/pk /workspace/.tool-log

# Activate shell logger as SHELL for runtime (after all build RUNs)
ENV SHELL=/usr/local/bin/pk-shell-logger

# Agent instructions
COPY packages/containers/agent/AGENT.md /workspace/AGENT.md

# ── Stage 1: Recon tools ────────────────────────────────────────────
FROM base AS recon

RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap ncat netcat-traditional \
    ffuf gobuster nikto whatweb wafw00f \
    dnsutils whois curl wget \
    openvpn iproute2 iputils-ping iptables \
    openssh-client sshpass \
    python3 python3-pip \
    git jq xmlstarlet \
    && rm -rf /var/lib/apt/lists/*

# rustscan (not in apt, install from GitHub release)
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/RustScan/RustScan/releases/latest/download/rustscan_${ARCH}.deb" \
      -o /tmp/rustscan.deb && dpkg -i /tmp/rustscan.deb && rm /tmp/rustscan.deb || true

# httpx-toolkit (only if Go is in the base image)
RUN command -v go >/dev/null 2>&1 && \
    go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest || true

# Wordlists
RUN mkdir -p /usr/share/wordlists && \
    if [ ! -d /usr/share/seclists ]; then \
      git clone --depth 1 https://github.com/danielmiessler/SecLists.git /usr/share/seclists; \
    fi

WORKDIR /workspace

# ── Stage 2: Attack tools (extends recon) ───────────────────────────
FROM recon AS attack

RUN apt-get update && apt-get install -y --no-install-recommends \
    enum4linux smbclient ldap-utils \
    john hashcat \
    responder proxychains4 \
    sqlmap \
    tcpdump tshark \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir \
    impacket certipy-ad bloodyAD pysocks 2>/dev/null || true

RUN gem install evil-winrm 2>/dev/null || true

WORKDIR /workspace

# ── Stage 3: Full (extends attack) ─────────────────────────────────
FROM attack AS full

RUN apt-get update && apt-get install -y --no-install-recommends \
    mingw-w64 \
    build-essential python3-dev \
    binutils \
    && rm -rf /var/lib/apt/lists/*

# Gleipnir agent binaries (optional, only if built)
# Use a builder stage to avoid COPY failure when binaries don't exist
ARG GLEIPNIR_AGENTS=/opt/gleipnir/agents
RUN mkdir -p ${GLEIPNIR_AGENTS}

WORKDIR /workspace
