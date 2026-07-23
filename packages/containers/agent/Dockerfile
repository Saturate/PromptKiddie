# pk-agent: Cartridge + pk CLI + attack tools.
# Build context must be the repo root. Run `pnpm build` before building.
#
#   pnpm build && docker build -t pk-agent -f packages/containers/agent/Dockerfile .
#
# Layer order optimized for caching:
#   1. Base (cartridge) - rarely changes
#   2. System packages (apt) - rarely changes
#   3. Python/Ruby tools (pip, gem) - rarely changes
#   4. Binary tools (GitHub releases) - rarely changes, no build deps
#   5. Pre-staged attack binaries (privesc, AD, pivot) - rarely changes
#   6. Wordlists (seclists) - large, stable
#   7. PK code bundle - changes every commit
#   8. Agent instructions (md files) - changes occasionally

FROM cartridge:latest

# Pin tool versions for deterministic builds. Bump these to update.
ARG RUSTSCAN_TAG=2.3.0
ARG HTTPX_TAG=v1.7.1
ARG NUCLEI_TAG=v3.4.5
ARG CHISEL_TAG=v1.10.1
ARG LIGOLO_TAG=v0.7.5
ARG KERBRUTE_TAG=v1.0.3
ARG MIMIKATZ_TAG=2.2.0-20220919

# ── 1. System packages (apt - stable, expensive) ─────────────────

RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap ncat netcat-traditional \
    ffuf gobuster whatweb wafw00f \
    dnsutils whois curl wget \
    openvpn iproute2 iputils-ping iptables \
    openssh-client sshpass rsync socat \
    python3 python3-pip \
    git jq xmlstarlet \
    smbclient ldap-utils snmp \
    john hashcat \
    proxychains4 \
    sqlmap \
    tcpdump tshark \
    mingw-w64 \
    build-essential python3-dev \
    binutils unzip \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Python/Ruby tools (pip/gem - stable) ──────────────────────

RUN pip3 install --break-system-packages --no-cache-dir \
    impacket certipy-ad bloodyAD pysocks \
    responder dnsrecon

RUN pip3 install --break-system-packages --no-cache-dir \
    netexec || echo "WARNING: netexec requires Python 3.12+, using crackmapexec fallback" && \
    pip3 install --break-system-packages --no-cache-dir crackmapexec || true

RUN pip3 install --break-system-packages --no-cache-dir \
    git+https://github.com/cddmp/enum4linux-ng.git || true

RUN pip3 install --break-system-packages --no-cache-dir \
    name-that-hash search-that-hash || true

RUN gem install evil-winrm || true

# ── 3. Binary tools from GitHub releases ─────────────────────────

RUN ARCH=$(dpkg --print-architecture) && \
    GOARCH=$(case "$ARCH" in amd64) echo amd64;; arm64) echo arm64;; *) echo "$ARCH";; esac) && \
    # rustscan (try .deb first, then zip)
    (curl -fsSL "https://github.com/RustScan/RustScan/releases/download/${RUSTSCAN_TAG}/rustscan_${RUSTSCAN_TAG}_${ARCH}.deb" -o /tmp/rustscan.deb && \
     dpkg -i /tmp/rustscan.deb && rm /tmp/rustscan.deb) || \
    (RSARCH=$(case "$ARCH" in amd64) echo x86_64-linux;; arm64) echo aarch64-linux;; *) echo "$ARCH";; esac) && \
     curl -fsSL "https://github.com/RustScan/RustScan/releases/download/${RUSTSCAN_TAG}/${RSARCH}-rustscan.zip" -o /tmp/rs.zip && \
     unzip -o /tmp/rs.zip -d /usr/local/bin && chmod +x /usr/local/bin/rustscan && rm /tmp/rs.zip) || \
    echo "WARNING: rustscan not available for ${ARCH}"; \
    # httpx
    curl -fsSL "https://github.com/projectdiscovery/httpx/releases/download/${HTTPX_TAG}/httpx_${HTTPX_TAG#v}_linux_${GOARCH}.zip" -o /tmp/httpx.zip && \
    unzip -o /tmp/httpx.zip -d /usr/local/bin httpx && chmod +x /usr/local/bin/httpx && rm /tmp/httpx.zip; \
    # nuclei
    curl -fsSL "https://github.com/projectdiscovery/nuclei/releases/download/${NUCLEI_TAG}/nuclei_${NUCLEI_TAG#v}_linux_${GOARCH}.zip" -o /tmp/nuclei.zip && \
    unzip -o /tmp/nuclei.zip -d /usr/local/bin nuclei && chmod +x /usr/local/bin/nuclei && rm /tmp/nuclei.zip; \
    # chisel
    curl -fsSL "https://github.com/jpillora/chisel/releases/download/${CHISEL_TAG}/chisel_${CHISEL_TAG#v}_linux_${GOARCH}.gz" | gunzip > /usr/local/bin/chisel && \
    chmod +x /usr/local/bin/chisel; \
    # ligolo-ng (proxy + agent)
    curl -fsSL "https://github.com/nicocha30/ligolo-ng/releases/download/${LIGOLO_TAG}/ligolo-ng_proxy_${LIGOLO_TAG#v}_linux_${GOARCH}.tar.gz" | tar xz -C /usr/local/bin ligolo-proxy && \
    curl -fsSL "https://github.com/nicocha30/ligolo-ng/releases/download/${LIGOLO_TAG}/ligolo-ng_agent_${LIGOLO_TAG#v}_linux_${GOARCH}.tar.gz" | tar xz -C /usr/local/bin ligolo-agent; \
    # kerbrute
    (curl -fsSL "https://github.com/ropnop/kerbrute/releases/download/${KERBRUTE_TAG}/kerbrute_linux_${GOARCH}" -o /usr/local/bin/kerbrute && \
    chmod +x /usr/local/bin/kerbrute) || echo "WARNING: kerbrute not available for ${GOARCH}"

# nikto (not in Debian repos, install from source)
RUN apt-get update && apt-get install -y --no-install-recommends \
    perl libnet-ssleay-perl libjson-perl && \
    rm -rf /var/lib/apt/lists/* && \
    git clone --depth 1 https://github.com/sullo/nikto.git /opt/nikto && \
    ln -sf /opt/nikto/program/nikto.pl /usr/local/bin/nikto && \
    chmod +x /opt/nikto/program/nikto.pl

# ── 4. Pre-staged attack binaries (upload to targets) ────────────

RUN mkdir -p /opt/privesc /opt/windows /opt/pivot && \
    # linpeas + winpeas
    curl -fsSL https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh -o /opt/privesc/linpeas.sh && \
    curl -fsSL https://github.com/peass-ng/PEASS-ng/releases/latest/download/winPEASx64.exe -o /opt/privesc/winpeas.exe && \
    # pspy
    curl -fsSL https://github.com/DominicBreuker/pspy/releases/latest/download/pspy64 -o /opt/privesc/pspy64 && \
    chmod +x /opt/privesc/pspy64 /opt/privesc/linpeas.sh && \
    # mimikatz
    curl -fsSL "https://github.com/gentilkiwi/mimikatz/releases/download/${MIMIKATZ_TAG}/mimikatz_trunk.zip" -o /tmp/mimi.zip && \
    unzip -o /tmp/mimi.zip -d /opt/windows/mimikatz && rm /tmp/mimi.zip && \
    # rubeus (pre-compiled from SharpCollection)
    curl -fsSL https://github.com/Flangvik/SharpCollection/raw/master/NetFramework_4.7_Any/Rubeus.exe -o /opt/windows/Rubeus.exe && \
    # chisel + ligolo for Windows (upload to targets)
    curl -fsSL "https://github.com/jpillora/chisel/releases/download/${CHISEL_TAG}/chisel_${CHISEL_TAG#v}_windows_amd64.gz" | gunzip > /opt/pivot/chisel.exe && \
    # chisel linux static for targets
    curl -fsSL "https://github.com/jpillora/chisel/releases/download/${CHISEL_TAG}/chisel_${CHISEL_TAG#v}_linux_amd64.gz" | gunzip > /opt/pivot/chisel_linux && \
    chmod +x /opt/pivot/chisel_linux || true

# ── 5. Smoke test (catch failures before expensive wordlists) ────

RUN echo "=== Tool smoke test ===" && \
    nmap --version 2>&1 | head -1 && \
    python3 -c "import impacket; print('impacket OK')" && \
    python3 -c "from certipy.entry import main; print('certipy OK')" && \
    nuclei -version 2>&1 | head -1 && \
    chisel --version 2>&1 | head -1 && \
    httpx -version 2>&1 | head -1 && \
    test -f /opt/privesc/linpeas.sh && echo "linpeas OK" && \
    test -f /opt/windows/Rubeus.exe && echo "rubeus OK" && \
    test -f /opt/pivot/chisel.exe && echo "pivot tools OK" && \
    echo "=== Smoke test complete ==="

# ── 6. Wordlists (stable, large - git clone is slow) ─────────────

RUN mkdir -p /usr/share/wordlists && \
    git clone --depth 1 --single-branch https://github.com/danielmiessler/SecLists.git /usr/share/seclists

# ── 7. PK code bundle (changes often - keep late) ────────────────

COPY packages/scripts/shell-logger.sh /usr/local/bin/pk-shell-logger
RUN chmod +x /usr/local/bin/pk-shell-logger

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
RUN pnpm install --frozen-lockfile && \
    printf '#!/bin/sh\nnode /opt/pk/packages/cli/dist/index.js "$@"\n' > /usr/local/bin/pk && \
    chmod +x /usr/local/bin/pk && \
    cp /opt/pk/packages/cli/bin/pkx /usr/local/bin/pkx && chmod +x /usr/local/bin/pkx

RUN mkdir -p /etc/pk /workspace/.tool-log
ENV SHELL=/usr/local/bin/pk-shell-logger

# ── 8. Agent instructions (last - cheapest to change) ────────────

COPY packages/containers/agent/AGENT.md /workspace/AGENT.md
COPY packages/containers/agent/ORCHESTRATOR.md /workspace/ORCHESTRATOR.md
COPY packages/containers/agent/role-init.sh /usr/local/bin/pk-role-init
RUN chmod +x /usr/local/bin/pk-role-init && \
    ln -sf AGENT.md /workspace/CLAUDE.md

# Gleipnir agent binaries (optional)
ARG GLEIPNIR_AGENTS=/opt/gleipnir/agents
RUN mkdir -p ${GLEIPNIR_AGENTS}

WORKDIR /workspace
