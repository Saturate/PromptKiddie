# Harness Portability

Ensure PK works identically across Claude Code, Codex, OpenCode, Pi, and direct API.

## Problem

Agent definitions (`.claude/agents/*.md`) are Claude Code specific. The MCP tools and
CLI work with any harness, but the agent behavior instructions (workflow, version logging,
target verification, evidence discipline) only reach Claude Code agents. An agent running
in Codex or Pi doesn't get these instructions.

## Current state

| Component | Portable? | Notes |
|-----------|-----------|-------|
| pk CLI | Yes | Runs anywhere with Node.js |
| MCP server (engagement tools) | Yes | Any MCP-compatible harness |
| MCP server (tooling tools) | Yes | Any MCP-compatible harness |
| Supervisor | Yes | Standalone process |
| `.claude/agents/*.md` | No | Claude Code only |
| `.claude/skills/*.md` | No | Claude Code only |
| `CLAUDE.md` | No | Claude Code + Cursor |
| `OPENCODE.md` | Partial | OpenCode only |
| `AGENT.md` (v2 container) | Yes | Read by any harness in the container |

## Solution

### 1. Portable agent instructions in AGENT.md

The v2 container `AGENT.md` (`packages/containers/agent/AGENT.md`) is harness-agnostic.
It should contain ALL the behavioral instructions currently split across:
- `.claude/agents/recon-agent.md`
- `.claude/agents/enum-agent.md`
- `.claude/agents/exploit-agent.md`
- `.claude/skills/exploitation/SKILL.md`
- `.claude/skills/enumeration/SKILL.md`
- `.claude/skills/recon/SKILL.md`

In v2 containers, the harness reads AGENT.md (or the equivalent for its config format)
and gets the full instruction set.

### 2. Claude Code agents as thin wrappers

Keep `.claude/agents/*.md` but make them reference the portable instructions:

```markdown
Follow the instructions in AGENT.md for your core workflow. This file adds
Claude Code specific configuration (tool access, model settings).
```

### 3. Harness-specific config files

Each harness reads its own config for agent definitions:

| Harness | Config | Agent definition |
|---------|--------|-----------------|
| Claude Code | `.claude/agents/*.md` | Frontmatter + instructions |
| Codex | `codex.json` or `AGENTS.md` | Task descriptions |
| OpenCode | `OPENCODE.md` | System prompt |
| Pi | `pi.toml` or `PI.md` | Agent config |

The portable AGENT.md is the source of truth. Harness configs import or reference it.

### 4. MCP tool descriptions as implicit instructions

The MCP tool descriptions themselves carry behavioral guidance:

```
log_version: "Call this EVERY TIME you identify a service with a version number."
```

This works across all harnesses because the tool description is part of the MCP protocol.

## Testing plan

1. Run the same engagement (e.g. DVWA target) with Claude Code, then with OpenCode
2. Compare: did both agents call `log_version`? Did both register webshells?
3. Verify: MCP tool descriptions are sufficient for basic workflow compliance
4. Gap analysis: what instructions only work when the full AGENT.md is loaded?

## Dependencies

- V2 containers must be buildable and runnable
- At least one non-Claude-Code harness must be configured (OpenCode is easiest)
