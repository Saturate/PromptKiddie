## 0.1.3 (2026-07-31)

### Features

- Rename `[attackbox]` config section to `[toolbox]`, consolidate phase containers into single `pk-agent` image. Legacy `[attackbox]` TOML configs are auto-migrated.

## 0.1.2 (2026-07-21)

### Features

- unified API architecture (all phases) (#8)

### Fixes

- move engagement hooks behind pk init (#7)

## 0.1.1 (2026-07-16)

### Fixes

- graceful host route setup when sudo is unavailable
