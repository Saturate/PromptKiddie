# @promptkiddie/mcp-server

[MCP](https://modelcontextprotocol.io) server that exposes the PromptKiddie engagement database to AI agents (Claude Code, OpenCode, etc.).

## Tools

`create_engagement`, `list_engagements`, `get_engagement`, `update_engagement`, `delete_engagement`, `set_engagement_status`, `add_target`, `list_targets`, `update_target`, `add_service`, `list_services`, `get_service`, `add_finding`, `list_findings`, `update_finding`, `add_objective`, `list_objectives`, `capture_flag`, `advance_phase`, `get_phase`, `log_activity`, `list_activity`, `add_evidence`, `list_evidence`, `search_knowledge`

## Setup

Via the PK CLI (recommended):

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

Or directly:

```bash
DATABASE_URL=postgres://... npx @promptkiddie/mcp-server
```

## Environment

- `DATABASE_URL` - Postgres connection string (required)
