#!/bin/bash
set -e

# Create tun device if needed
mkdir -p /dev/net
[ -c /dev/net/tun ] || mknod /dev/net/tun c 10 200

VPN_COUNT=$(find /vpn -maxdepth 1 -name '*.ovpn' 2>/dev/null | wc -l | tr -d ' ')
if [ "$VPN_COUNT" -gt 0 ]; then
    echo "[tooling] $VPN_COUNT VPN profile(s) available. Connect with: pk vpn up [name]"
else
    echo "[tooling] No VPN profiles in /vpn/. Add with: pk vpn add <name> /path/to/config.ovpn"
fi

echo "[tooling] Ready."
exec sleep infinity
