#!/bin/sh
set -e

mkdir -p /dev/net /workspace/.tool-log 2>/dev/null
[ -c /dev/net/tun ] || mknod /dev/net/tun c 10 200

IMAGE_TYPE="${PK_IMAGE_TYPE:-base}"

# Show MotD
if [ -f "/etc/pk-motd.sh" ]; then
    sh /etc/pk-motd.sh
fi

VPN_COUNT=$(find /vpn -maxdepth 1 -name '*.ovpn' 2>/dev/null | wc -l | tr -d ' ')
if [ "$VPN_COUNT" -gt 0 ]; then
    echo "  $VPN_COUNT VPN profile(s) available: pk vpn up [name]"
fi

exec sleep infinity
