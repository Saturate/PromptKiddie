FROM rust:1-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
RUN cargo build --release --bin gleipnir-server \
    && strip target/release/gleipnir-server
RUN cargo build --release --bin gleipnir-cli \
    && strip target/release/gleipnir-cli || true

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/target/release/gleipnir-server /usr/local/bin/gleipnir-server
COPY --from=builder /src/target/release/gleipnir-cli /usr/local/bin/gleipnir-cli

# Fetch pre-compiled agent binaries from GitHub releases (best-effort)
RUN mkdir -p /opt/gleipnir/agents && \
    REPO="Saturate/PromptKiddie" && \
    TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | jq -r '.tag_name // empty') && \
    if [ -n "$TAG" ]; then \
      for bin in pk-agent-linux-amd64 pk-agent-linux-amd64-tls pk-agent-linux-arm64 pk-agent-linux-arm64-tls pk-agent-windows-amd64.exe pk-agent-windows-amd64-tls.exe; do \
        curl -fsSL "https://github.com/${REPO}/releases/download/${TAG}/${bin}" -o "/opt/gleipnir/agents/${bin}" 2>/dev/null || true; \
      done; \
      chmod +x /opt/gleipnir/agents/pk-agent-* 2>/dev/null || true; \
    fi

EXPOSE 4444 6666
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD curl -sf http://localhost:6666/api/health || exit 1
ENTRYPOINT ["gleipnir-server"]
