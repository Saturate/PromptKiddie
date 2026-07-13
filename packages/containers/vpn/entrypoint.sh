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

# Enable forwarding (iptables rules set by --up script after tun0 is created)
echo 1 > /proc/sys/net/ipv4/ip_forward

# Write an --up script that configures NAT after tun0 is live
cat > /tmp/vpn-up.sh << 'UPSCRIPT'
#!/bin/sh
# Detect the default interface dynamically
DEFAULT_IF=$(ip route | awk '/default/{print $5; exit}')
iptables -t nat -A POSTROUTING -o "$dev" -j MASQUERADE 2>/dev/null || true
if [ -n "$DEFAULT_IF" ]; then
  iptables -A FORWARD -i "$DEFAULT_IF" -o "$dev" -j ACCEPT 2>/dev/null || true
  iptables -A FORWARD -i "$dev" -o "$DEFAULT_IF" -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
fi
UPSCRIPT
chmod +x /tmp/vpn-up.sh

# Start OpenVPN in foreground with the --up script
exec openvpn --config "$CONFIG" --verb 3 \
  --script-security 2 --up /tmp/vpn-up.sh
