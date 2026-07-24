# @promptkiddie/cli

CLI for managing PromptKiddie engagements, targets, findings, and running the MCP server.

## Install

```bash
npm install -g @promptkiddie/cli
```

## Commands

```bash
# Engagements
pk engagement new --name "Target" --type ctf
pk engagement list
pk engagement status <id> --set active

# Targets and findings
pk target add --engagement <id> --identifier 10.10.11.x
pk finding add --engagement <id> --title "SQLi in login" --severity high
pk finding list --engagement <id>

# Phases and flags
pk phase advance --engagement <id>
pk flag submit --engagement <id> --flag "HTB{...}"

# Activity
pk activity log --engagement <id> --message "Found open port 80"
pk activity list --engagement <id>

# MCP server (for AI agent integration)
pk mcp

# Scaffold a workspace
pk init                          # interactive setup
pk init ctf --platform htb       # CTF event with HTB integration
```

## MCP server

`pk mcp` starts the PK MCP server on stdio. Use it in Claude Code or other MCP-compatible agents:

```json
{
  "mcpServers": {
    "promptkiddie": {
      "command": "npx",
      "args": ["-y", "-p", "@promptkiddie/cli", "pk", "mcp"],
      "env": { "DATABASE_URL": "postgres://..." }
    }
  }
}
```

## Environment

- `DATABASE_URL` - Postgres connection string
