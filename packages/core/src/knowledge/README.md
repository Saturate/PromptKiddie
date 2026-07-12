# Knowledge Base

PK's knowledge base is a directory of markdown files with YAML frontmatter, following
Google's [Open Knowledge Format (OKF) v0.1](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
Files are chunked, embedded via nomic-embed-text, and stored in pgvector for hybrid
search (vector similarity + keyword).

## Structure

```
knowledge/
  techniques/     Pentest technique cards (how to do X)
  exploits/       CVE + PoC cards (product Y version Z is vulnerable to W)
```

## Format

Every `.md` file is an OKF concept document:

```markdown
---
type: technique | exploit
title: Human-readable name
description: One-sentence summary
tags: [searchable, tags]
# ... additional fields per type
---

# Title

Markdown body with exploitation steps, detection, operational notes.
```

The `type` field is required per OKF spec. All other frontmatter fields are stored in
the embeddings metadata column and are queryable.

### Technique cards

Describe how to perform a technique. Fields: ATT&CK mapping, platform, services,
phase.

See [techniques/](techniques/) for examples.

### Exploit cards

Map a specific CVE to affected products/versions with exploitation guidance. Additional
fields: `cve`, `product`, `affected` (semver range), `fixed`, `cvss`, `severity`,
`poc` (vendored/link/reference), `poc_license`.

See [exploits/README.md](exploits/README.md) for the full field reference and PoC
licensing rules.

## Search

```bash
pk knowledge search "Next.js server action RCE"
pk knowledge search "privilege escalation SUID"
pk knowledge search "NTLM relay"
```

Hybrid mode (default) combines vector similarity and keyword matching via reciprocal
rank fusion.

## Ingestion

```bash
# Ingest exploit cards
pk knowledge ingest packages/core/src/knowledge/exploits --source pk-exploits

# Ingest technique cards
pk knowledge ingest packages/core/src/knowledge/techniques --source pk-techniques

# Check what's ingested
pk knowledge sources
```

Frontmatter is parsed and stored in the embeddings metadata field, so card fields
(CVE, product, severity) are available for structured queries alongside vector search.

## Adding cards

1. Create a `.md` file in the appropriate directory
2. Add OKF-compliant frontmatter (at minimum: `type`, `title`, `description`)
3. Write the body with exploitation/technique details
4. Run `pk knowledge ingest` to embed and index

For exploit cards, check [exploits/README.md](exploits/README.md) for PoC licensing
requirements before vendoring any scripts.
