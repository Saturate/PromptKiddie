---
"@promptkiddie/core": minor
"@promptkiddie/api": minor
"@promptkiddie/daemon": minor
"@promptkiddie/cli": patch
"@promptkiddie/mcp-server": minor
"@promptkiddie/spa": patch
"@promptkiddie/tooling-mcp": patch
---

Codebase audit cleanup: rename supervisor->daemon and toolbox->worker across packages, fix WS alias resolution for authenticated clients, add supervisor case to container role-init, add events.created_at index, add missing MCP tools (ports, webshells, events, discoveries, agent log, evidence data, settings), remove dead code.
