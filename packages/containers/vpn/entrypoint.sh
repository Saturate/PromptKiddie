#!/bin/bash
set -euo pipefail

VPN_DIR="/vpn"
PROFILE="${VPN_PROFILE:-}"

# Auto-select if only one profile exists
if [ -z "$PROFILE" ]; then
  PROFILES=("$VPN_DIR"/*.ovpn)
  if [ ${#PROFILES[@]} -eq 0 ]; then
    echo "[vpn] No .ovpn files in $VPN_DIR"
    exit 1
  elif [ ${#PROFILES[@]} -eq 1 ]; then
    PROFILE=$(basename "${PROFILES[0]}" .ovpn)
  else
    echo "[vpn] Multiple profiles found. Set VPN_PROFILE env var:"
    for p in "${PROFILES[@]}"; do echo "  $(basename "$p" .ovpn)"; done
    exit 1
  fi
fi

CONFIG="${VPN_DIR}/${PROFILE}.ovpn"
if [ ! -f "$CONFIG" ]; then
  echo "[vpn] Profile not found: $CONFIG"
  exit 1
fi

echo "[vpn] Connecting profile: $PROFILE"

# Enable forwarding + NAT
echo 1 > /proc/sys/net/ipv4/ip_forward
iptables -t nat -A POSTROUTING -o tun0 -j MASQUERADE 2>/dev/null || true
iptables -A FORWARD -i eth0 -o tun0 -j ACCEPT 2>/dev/null || true
iptables -A FORWARD -i tun0 -o eth0 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true

# Start OpenVPN in foreground (container lifecycle tied to VPN)
exec openvpn --config "$CONFIG" --verb 3
