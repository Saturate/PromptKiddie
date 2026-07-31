---
cli: minor
mcp-server: patch
core: patch
daemon: patch
---

Publish core, daemon, mcp-server, and cli to npm. Adds `pk mcp` subcommand that starts the MCP server on stdio. `pk init ctf` now generates `npx @promptkiddie/cli mcp` for the PK MCP config and `htb --mcp-stdio` for HTB. Release workflow publishes to npm via OIDC trusted publishing.
