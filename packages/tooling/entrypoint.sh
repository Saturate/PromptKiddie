#!/bin/bash
set -e

# Create tun device if needed
mkdir -p /dev/net
[ -c /dev/net/tun ] || mknod /dev/net/tun c 10 200

if [ -f /vpn/config.ovpn ]; then
    echo "[tooling] VPN config found at /vpn/config.ovpn"
    echo "[tooling] Start it with: pk vpn up"
else
    echo "[tooling] No VPN config at /vpn/config.ovpn"
fi

echo "[tooling] Ready."
exec sleep infinity
