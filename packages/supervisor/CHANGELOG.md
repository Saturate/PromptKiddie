## 0.1.1 (2026-07-16)

### Features

- lifecycle management, compose service, direct docker spawn
- start agents via Cartridge API instead of PK inbox

### Fixes

- forward provider keys and harness config to agent containers
- write cartridge.toml for agent containers instead of env vars
- forward CLAUDE_CODE_OAUTH_TOKEN to agent containers
