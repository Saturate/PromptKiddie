## 0.1.2 (2026-07-21)

### Features

- unified API architecture (all phases) (#8)

### Fixes

- format truncate functions to pass cargo fmt (#5)
- enumerate docker images, fix socket bitmask (#6)
- move engagement hooks behind pk init (#7)

## 0.1.1 (2026-07-16)

### Features

- finish M2 (LISTEN/NOTIFY + SSE) and M3 (network isolation)
- Kali image working, add DVWA + Juice Shop test targets
- phase state machine on engagements
- objectives table, source_url, engagement grouping, build fixes
- dual logging (auto tool log + agent reasoning log), rustcat, ncat
- agent inbox replies, CTF writeup skill, agent status in UI
- add 'created' engagement status as default
- pk think command, --agent on pk exec, CeWL in enum skill, agent log UI
- add 'flag' evidence type for CTF captures
- command discipline in CLAUDE.md, fix flag evidence type
- target status (active/expired) for IP changes in CTFs
- pk exec --host flag for VPN targets, PK_EXEC_MODE=local env override
- OpenVPN in tooling container + pk vpn up/down/status
- artifacts table (loot, creds, docs - flexible type), noted pentagi for research
- surgical-over-exhaustive in CLAUDE.md and recon skill
- Typst report template - dark cover, professional pages, finding cards, attack chain, flag capture, evidence blocks
- pk report generate + frontend download button + API route
- objectives, artifacts, exec truncation, engagement update, VPN docs
- TOML config system, attackbox rename, GHCR image workflow
- API layer with Hono, bearer auth, Repo abstraction
- pk init - scaffold workspace with harness-specific files
- integrated chat harness with Vercel AI SDK
- settings page with model/provider config
- ToolLoopAgent orchestrator with phase sub-agents
- exec tool + multi-provider support in chat
- type-driven UI for engagement detail page
- Langfuse observability for chat (opt-in)
- Docker containers for web + api, GHCR workflow
- floating chat widget + AI SDK v7 migration
- custom provider, chat modes, model list API
- model dropdowns fetched from provider API
- IDE-style chat side panel replaces floating widget
- External Harness as default, inbox monitoring panel
- harness picker + live inbox panel
- add Codex (OpenAI) to harness picker
- improve tool definitions for local model compatibility
- manual agent loop for Ollama/compatible providers
- theme overhaul, stuck detection, ports, phase containers, evidence in DB
- pk exec auto-routes by engagement phase, README rewrite
- DB-driven playbooks with step tracking per engagement
- playbook UI, auto-assign on create, step tools for agents
- playbook editor at /settings/playbooks
- graph playbook foundation - react-flow, BT runtime, blocks, schema
- graph editor, BT runtime integration, block library, tmux shells
- dagre auto-layout, meta nodes, richer CTF playbook (48 steps)
- richer recon - whatweb, wafw00f, headers, favicon hash lookup
- block composition - playbooks reference shared reusable blocks
- block drill-down, edge-on-hover, breadcrumb navigation
- Obsidian-style file tree, blocks with start/end nodes
- custom playbook creation, target icon instead of folder
- control nodes (parallel/selector/join) + edge arrowheads
- OS-aware privesc block, node-type-aware properties panel
- delete-middle-node reconnect, add-node-on-drop, edge reconnect
- playbook-to-markdown serializer for LLM review
- graph-based playbooks with react-flow editor, BT runtime, reusable blocks
- wire playbook graph into execution with startStep, MCP tools, CLI commands
- lossless markdown round-trip for playbooks
- pk playbook export/import CLI for markdown round-trip
- auto-init playbook steps on engagement creation
- mermaid export for playbooks
- freestyle catch-all nodes + playbook improvement feedback loop
- Docker Events exec watcher for container telemetry
- knowledge base with hybrid search (vector + keyword)
- in-process ONNX embeddings, no server required
- embeddings settings UI on /settings page
- knowledge search page + favicon
- knowledge source management UI with pull/refresh/clear
- reactive playbooks foundation (events, discoveries, exec dedup, context builder)
- playbook SDK with action graph, simulation, and frontend visualization
- supervisor process with LISTEN/NOTIFY and SSE streaming
- event-driven supervisor with WebSocket streaming to frontend
- working reprioritize + priority-sorted dispatch in supervisor
- execution modes (race/standard/methodical/learning) in supervisor
- evidence path handling relative to engagement directory
- lateral movement action + pk ssh-plant command
- service entity with auto version events, CVE linking, and shell-logger parsing
- fast parallel privesc scanner for Linux and Windows (#3)
- Fast parallel privilege escalation scanner for Linux and Windows. 30 check modules run concurrently via rayon, outputting structured JSON for PK ingestion through Gleipnir. Linux: 17 checks (SUID/GTFOBins, sudo, capabilities, cron, kernel CVEs, docker/lxd, file perms, network, credentials, processes, user/group enum, systemd, mounts, SSH, env vars, D-Bus/polkit, snap). Windows: 13 checks (services, registry, tokens, scheduled tasks, credentials, DLL hijack, network, patches/CVEs, UAC, AD recon, processes/AV, cloud IMDS, event logs).

### Fixes

- exploitation skill - explicit flag capture procedure
- piping rule - intentional filtering is fine, unrelated chaining is not
- hydration mismatch + better settings labels
- drop Disabled mode, show pk init help for External Harness
- sidebar hydration mismatch - defer localStorage read to useEffect
- hooks order in chat widget - all hooks before early returns
- hide chat panel by default in harness mode
- Pi.dev is not Google's - corrected description
- Langfuse telemetry field + custom provider createOpenAI
- add explicit types to all tooling-mcp handler params (fixes CI)
- Dockerfile missing tooling-mcp package.json in deps stage
- CI Docker build - copy all package node_modules, relax mcp-server strict
- remove empty parameters from listEngagements tool (AI SDK v7)
- skip Next.js type checking in build (tsc already covers it)
- Dockerfile COPY doesn't support shell redirection
- use @ai-sdk/openai-compatible for custom providers
- use stopWhen: isStepCount() instead of deprecated maxSteps
- remove inline inbox from engagement page
- add dependsOn to CTF playbook steps, edges now visible in graph
- position-aware edge handles for horizontal and vertical links
- critical bugs from audit - initSteps copies deps, auto-skip, seed blocks
- hide edge handles by default, show on node hover
- loading spinner, URL-synced navigation, proper breadcrumb
- shared blocks have their own URL, breadcrumb shows 'Shared' as parent
- apply all review feedback - UDP, /etc/hosts, linpeas, SQLi/LFI, OS-aware flags
- apply Opus review to CTF playbook (42 → 50 steps)
- address Opus second review - targets.os conditions, harvest deps
- address all 8 Jump CTF retro action items
- pk knowledge pull clones inside Docker container
- hide ONNX import from webpack static analysis
- knowledge search uses OR logic, default mode is hybrid
- progress % counts skipped as complete, limit activity to 50 rows
- address round 2 review findings
- wire recordExecOutcome into pk exec, parallelize port queries
- close critical gaps in supervisor execution
- address code review findings across v2 changes
- review loop iteration 1 findings
- review loop iteration 2 findings
- port_scan now emits VersionIdentified + CVE search in agent instructions
- all 8 Enigma retro action items
- web_recon fallback, IMAP action, agent attribution, workflow prompts
- review findings - TOML escaping, config cleanup, file perms, type casts
