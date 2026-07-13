# pk-vpn: lightweight VPN sidecar for Linux hosts.
# On macOS + Colima, VPN runs in the VM instead (pk vpn up handles this).
# Other containers share this container's network via network_mode: service:vpn.

FROM alpine:latest

RUN apk add --no-cache openvpn iproute2 iptables bash

COPY packages/containers/vpn/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
