---
"@promptkiddie/core": patch
"@promptkiddie/daemon": patch
---

Emit FindingAdded event from addFinding so the daemon's exploit action fires on MCP-added findings. Fix daemon event dedup to include payload key, preventing infinite re-runs of the same action for identical events.
