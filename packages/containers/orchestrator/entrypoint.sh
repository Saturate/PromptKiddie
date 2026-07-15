#!/bin/sh
# Start supervisor in standby mode (background). It listens for new engagements
# on Postgres NOTIFY and auto-starts a supervisor instance for each.
node /opt/pk/packages/supervisor/dist/index.js --standby &

# Delegate to the Cartridge entrypoint (starts ttyd, sshd, etc.)
exec /usr/local/bin/entrypoint.sh "$@"
