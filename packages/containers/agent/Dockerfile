# pk-agent: Cartridge + pk CLI + attack tools.
# Build context must be the repo root. Run `pnpm build` before building.
#
#   pnpm build && docker build -t pk-agent -f packages/containers/agent/Dockerfile .

FROM cartridge:latest

# Shell logger (activated as SHELL via ENV after build)
COPY packages/scripts/shell-logger.sh /usr/local/bin/pk-shell-logger
RUN chmod +x /usr/local/bin/pk-shell-logger

# Bundle pre-built pk CLI (host must run pnpm build first)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json /opt/pk/
COPY packages/core/package.json packages/core/tsconfig.json /opt/pk/packages/core/
COPY packages/core/dist /opt/pk/packages/core/dist
COPY packages/core/src/knowledge /opt/pk/packages/core/src/knowledge
COPY packages/cli/package.json packages/cli/tsconfig.json /opt/pk/packages/cli/
COPY packages/cli/dist /opt/pk/packages/cli/dist
COPY packages/cli/bin /opt/pk/packages/cli/bin
COPY packages/supervisor/package.json packages/supervisor/tsconfig.json /opt/pk/packages/supervisor/
COPY packages/supervisor/src /opt/pk/packages/supervisor/src
COPY packages/mcp-server/package.json packages/mcp-server/tsconfig.json /opt/pk/packages/mcp-server/
COPY packages/mcp-server/dist /opt/pk/packages/mcp-server/dist

WORKDIR /opt/pk
RUN pnpm install --frozen-lockfile

RUN printf '#!/bin/sh\nnode /opt/pk/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/pk && \
    chmod +x /usr/local/bin/pk
RUN cp /opt/pk/packages/cli/bin/pkx /usr/local/bin/pkx && chmod +x /usr/local/bin/pkx

RUN mkdir -p /etc/pk /workspace/.tool-log

# Activate shell logger as SHELL for runtime
ENV SHELL=/usr/local/bin/pk-shell-logger

# Agent instructions (CLAUDE.md is what the harness reads)
COPY packages/containers/agent/AGENT.md /workspace/AGENT.md
RUN ln -s AGENT.md /workspace/CLAUDE.md

# ── All tools in one image ─────────────────────────────────────────

# Recon
RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap ncat netcat-traditional \
    ffuf gobuster whatweb wafw00f \
    dnsutils whois curl wget \
    openvpn iproute2 iputils-ping iptables \
    openssh-client sshpass \
    python3 python3-pip \
    git jq xmlstarlet \
    && rm -rf /var/lib/apt/lists/*

# rustscan: try cargo first (reliable), then .deb fallback
RUN if command -v cargo >/dev/null 2>&1; then \
      cargo install rustscan 2>/dev/null && \
      cp "$(find /root/.cargo/bin -name rustscan 2>/dev/null | head -1)" /usr/local/bin/rustscan 2>/dev/null; \
    fi; \
    if ! command -v rustscan >/dev/null 2>&1; then \
      ARCH=$(dpkg --print-architecture) && \
      (curl -fsSL "https://github.com/RustScan/RustScan/releases/download/2.3.0/rustscan_2.3.0-1_${ARCH}.deb" -o /tmp/rustscan.deb || \
       curl -fsSL "https://github.com/RustScan/RustScan/releases/download/2.3.0/rustscan_2.3.0_${ARCH}.deb" -o /tmp/rustscan.deb) && \
      dpkg -i /tmp/rustscan.deb && rm -f /tmp/rustscan.deb; \
    fi; \
    rustscan --version 2>/dev/null || echo "WARNING: rustscan not available, using nmap as fallback"

# httpx-toolkit
RUN command -v go >/dev/null 2>&1 && \
    go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest || true

# Wordlists
RUN mkdir -p /usr/share/wordlists && \
    if [ ! -d /usr/share/seclists ]; then \
      git clone --depth 1 https://github.com/danielmiessler/SecLists.git /usr/share/seclists; \
    fi

# Attack tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    smbclient ldap-utils \
    john hashcat \
    proxychains4 \
    sqlmap \
    tcpdump tshark \
    mingw-w64 \
    build-essential python3-dev \
    binutils \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir \
    impacket certipy-ad bloodyAD pysocks enum4linux-ng responder 2>/dev/null || true

RUN gem install evil-winrm 2>/dev/null || true

# Gleipnir agent binaries (optional, only if built)
ARG GLEIPNIR_AGENTS=/opt/gleipnir/agents
RUN mkdir -p ${GLEIPNIR_AGENTS}

WORKDIR /workspace
