#!/bin/sh
set -e

mkdir -p /dev/net /workspace/.tool-log 2>/dev/null
[ -c /dev/net/tun ] || mknod /dev/net/tun c 10 200

IMAGE_TYPE="${PK_IMAGE_TYPE:-base}"

# Show MotD
if [ -f "/etc/pk-motd.sh" ]; then
    sh /etc/pk-motd.sh
fi

if [ -f /vpn/config.ovpn ]; then
    echo "  VPN config found at /vpn/config.ovpn"
fi

exec sleep infinity
