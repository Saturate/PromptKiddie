# Custom Knowledge Mount

**Date:** 2026-07-16
**Status:** Proposed

## Problem

Docker users can't add custom exploit/technique knowledge without rebuilding the image. The OKF knowledge base is baked into `packages/core/src/knowledge/` at build time. Source users can edit files directly, but the Docker deployment (which is the primary distribution) has no extension point.

## Goal

Mount a host directory into the container so users can drop in custom OKF files. The supervisor picks them up at startup or on-demand without image rebuilds.

## Design

### Mount point

Add a default volume mount in `docker-compose.yml`:

```yaml
services:
  api:
    volumes:
      - ./knowledge:/app/knowledge:ro
```

The `knowledge/` directory follows the same structure as the built-in knowledge:

```
knowledge/
  exploits/
    my-custom-exploit.yaml
  techniques/
    internal-network-pivot.yaml
```

### Loading

At startup, the knowledge loader scans both:
1. Built-in: `packages/core/src/knowledge/` (compiled into the image)
2. Custom: `/app/knowledge/` (mounted from host, optional)

Custom entries with the same ID as a built-in entry override it. This lets users update stale entries without waiting for a release.

### OKF file format

Each file is a YAML document matching the existing OKF schema:

```yaml
id: custom-exploit-001
name: My Custom Exploit
type: exploit
products:
  - name: SomeProduct
    versions: ">=1.0 <2.0"
description: |
  What the vulnerability is and how to exploit it.
references:
  - https://example.com/advisory
tags: [rce, web]
```

### Validation

On load, validate each file against the OKF schema. Log and skip invalid files rather than crashing. Print a summary at startup:

```
[knowledge] loaded 22 built-in + 3 custom entries (1 override)
```

### pgvector integration

Custom entries get embedded and inserted into the vector store alongside built-in ones. The embedding runs on first load and caches in the DB. Re-embeds if the file's content hash changes.

## Implementation

1. Add volume mount to `docker-compose.yml` and `templates/common/docker-compose.yml`
2. Update the knowledge loader in `packages/core` to scan the mount path
3. Add override logic (custom ID matches built-in ID)
4. Add startup log summary
5. Update `pk init` to create the `knowledge/` directory with a README
6. Document in README and getting-started guides

## Not doing

- Hot-reload while supervisor is running (restart to pick up new files)
- Web UI for editing knowledge (file-based is fine)
- Remote knowledge sources (git repos, APIs) - future work
