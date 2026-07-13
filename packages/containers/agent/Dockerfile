# pk-agent: Cartridge + pk + attack tools. Models run commands directly.
# Multi-stage: recon, attack, full. Build with --target <stage>.
#
#   docker build --target recon -t pk-agent-recon .
#   docker build --target attack -t pk-agent-attack .
#   docker build --target full -t pk-agent-full .

# ── Stage 0: pk bundle (shared across all variants) ─────────────────
FROM cartridge:latest AS base

# Shell logger as SHELL: every command is logged automatically
COPY packages/scripts/shell-logger.sh /usr/local/bin/pk-shell-logger
RUN chmod +x /usr/local/bin/pk-shell-logger
ENV SHELL=/usr/local/bin/pk-shell-logger
SHELL ["/usr/local/bin/pk-shell-logger", "-c"]

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
# Use /bin/bash directly for build commands (shell-logger adds noise during build)
SHELL ["/bin/bash", "-c"]
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

# Restore shell logger as SHELL for runtime
SHELL ["/usr/local/bin/pk-shell-logger", "-c"]

RUN mkdir -p /etc/pk /workspace/.tool-log

# Agent instructions
COPY packages/containers/agent/AGENT.md /workspace/AGENT.md

# ── Stage 1: Recon tools ────────────────────────────────────────────
FROM base AS recon

SHELL ["/bin/bash", "-c"]
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

# httpx-toolkit
RUN go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest 2>/dev/null || true

# Wordlists
RUN mkdir -p /usr/share/wordlists && \
    if [ ! -d /usr/share/seclists ]; then \
      git clone --depth 1 https://github.com/danielmiessler/SecLists.git /usr/share/seclists; \
    fi

SHELL ["/usr/local/bin/pk-shell-logger", "-c"]
WORKDIR /workspace

# ── Stage 2: Attack tools (extends recon) ───────────────────────────
FROM recon AS attack

SHELL ["/bin/bash", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
    enum4linux smbclient ldap-utils \
    john hashcat \
    responder proxychains4 \
    sqlmap \
    tcpdump tshark \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir \
    impacket certipy-ad bloodyAD pysocks 2>/dev/null || true

# evil-winrm
RUN gem install evil-winrm 2>/dev/null || true

SHELL ["/usr/local/bin/pk-shell-logger", "-c"]
WORKDIR /workspace

# ── Stage 3: Full (extends attack) ─────────────────────────────────
FROM attack AS full

SHELL ["/bin/bash", "-c"]
RUN apt-get update && apt-get install -y --no-install-recommends \
    mingw-w64 \
    build-essential python3-dev \
    binutils \
    && rm -rf /var/lib/apt/lists/*

# Gleipnir agent binaries (for deployment to targets)
COPY packages/gleipnir/target/release/gleipnir-agent /opt/gleipnir/agents/pk-agent-linux-amd64 2>/dev/null || true

SHELL ["/usr/local/bin/pk-shell-logger", "-c"]
WORKDIR /workspace
