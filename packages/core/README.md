# @promptkiddie/core

Database schema, engagement repository, playbook SDK, and action graph for PromptKiddie.

## What's in here

- **Schema** - Drizzle ORM schema for engagements, targets, findings, services, events, and knowledge
- **Repo** - HTTP client for the PK API (engagements, targets, findings, activity, flags)
- **SDK** - Action type definitions, trigger predicates, and context builders for playbooks
- **Playbooks** - Built-in CTF (29 actions) and pentest (14 actions) playbooks
- **Action graph** - DAG builder and behavior-tree runtime for playbook execution
- **Knowledge** - Embedding-based search over security technique cards

## Usage

```typescript
import { getRepo, loadConfig } from "@promptkiddie/core";
import { CTF_ACTIONS } from "@promptkiddie/core/playbooks";

const repo = getRepo();
const engagement = await repo.createEngagement({ name: "Target", type: "ctf" });
```

## Environment

- `DATABASE_URL` - Postgres connection string (used by the repo's HTTP client target)
