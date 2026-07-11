FROM rust:1-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .
RUN cargo build --release --bin gleipnir-relay \
    && strip target/release/gleipnir-relay

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/target/release/gleipnir-relay /usr/local/bin/gleipnir-relay

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

EXPOSE 4444
ENTRYPOINT ["gleipnir-relay"]
