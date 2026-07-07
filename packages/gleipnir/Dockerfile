FROM rust:1-slim AS builder

WORKDIR /src
COPY . .
RUN cargo build --release --bin gleipnir-relay \
    && strip target/release/gleipnir-relay

FROM debian:bookworm-slim
COPY --from=builder /src/target/release/gleipnir-relay /usr/local/bin/gleipnir-relay
EXPOSE 4444
ENTRYPOINT ["gleipnir-relay"]
