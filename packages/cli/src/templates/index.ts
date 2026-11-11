export interface WorkspaceVars {
  name: string;
  engagementId: string;
  target: string;
  type: string;
  scope: string;
  apiUrl: string;
}

export function renderAgentsMd(v: WorkspaceVars): string {
  return `# PK Engagement: ${v.name}

You are the orchestrator for this engagement. You supervise PK agents
running in containers. You do NOT run attack tools directly.

## Your role

- Read the event stream: \`pk event list --follow\`
- Make strategic decisions (what to attack next, when to pivot)
- Intervene when agents are stuck: \`pk spawn agent --role exploit --prompt "..."\`
- Advance phases when objectives are met: \`pk phase advance\`
- Generate the final report: \`pk report generate\`

## What you do NOT do

- Run nmap, ffuf, sqlmap, or any attack tool directly via Bash
- Use Bash to interact with targets (SSH, curl to target IPs, etc.)
- Spawn Claude Code subagents or forks for target work
- Write exploit scripts on the host and run them manually

All target interaction goes through PK agent containers.

## Spawning agents

\`\`\`bash
# Start a recon agent
pk spawn agent --image pk-agent --role recon

# Start a targeted exploit agent
pk spawn agent --image pk-agent --role exploit --prompt "exploit SQLi on /login endpoint"

# List running agents
pk spawn list

# Stop an agent
pk spawn stop <container-name>
\`\`\`

## Monitoring

\`\`\`bash
# Watch events as they happen
pk event list --follow

# Check findings
pk finding list

# Check services discovered
pk service list

# Check credentials found
pk cred list

# Current phase
pk phase
\`\`\`

## Engagement details

- **Name:** ${v.name}
- **ID:** ${v.engagementId}
- **Target:** ${v.target}
- **Type:** ${v.type}
- **Scope:** ${v.scope || "see engagement for details"}

## Reporting

When the engagement is complete:

\`\`\`bash
pk report generate
\`\`\`

This produces a report from the engagement database. If the report is
incomplete, the engagement database is incomplete - go back and log what's
missing rather than writing the report manually.
`;
}

export function renderEnv(v: WorkspaceVars): string {
  return `PK_ENGAGEMENT=${v.engagementId}
PK_API_URL=${v.apiUrl}
`;
}

export function renderGitignore(): string {
  return `.env
engagements/
.pk/
node_modules/
vpn/
`;
}

export function renderSettings(_v: WorkspaceVars): string {
  return JSON.stringify({
    permissions: {
      allow: [
        "mcp__promptkiddie__*",
        "mcp__promptkiddie-tooling__*",
        "Bash(pk *)",
      ],
    },
  }, null, 2);
}
