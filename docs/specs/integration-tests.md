# Supervisor Integration Tests

Verify the supervisor's event cascade works end-to-end against a real or mocked target.

## Problem

The VersionIdentified -> cve_search pipeline was wired up but dead for weeks because no
test exercised the full event cascade. Unit tests mock the context; integration tests
need the supervisor, postgres, and either a real target or a mock server.

## Test cases

### 1. Event cascade: EngagementStarted -> PortDiscovered -> VersionIdentified -> cve_search

Start supervisor with a mock target. Verify:
- EngagementStarted fires port_scan
- port_scan emits PortDiscovered for each open port
- port_scan emits VersionIdentified for ports with version strings
- VersionIdentified triggers cve_search
- cve_search runs searchsploit and exploit index

### 2. Web recon fallback

Mock target with port 80 open, whatweb returns exit 1. Verify:
- web_recon falls back to header-based version extraction
- VersionIdentified still fires from Server header

### 3. NFS enumeration

Mock target with port 2049 open. Verify:
- nfs_enum triggers on PortDiscovered
- Shares are listed and files enumerated

### 4. Lateral movement loop

Emit CredentialFound with username+password. Verify:
- lateral_move action fires
- ShellObtained emitted on successful pivot
- post_exploit_enum + privesc + flag_capture re-trigger

### 5. Spawn retry cap

Configure supervisor with non-existent agent image. Verify:
- Spawn fails at most 2 times per action+image
- Falls back to inbox after cap reached
- No spam

### 6. Phase advancement

Emit events in sequence. Verify:
- PortDiscovered (after scans complete) -> phase: enum
- FindingAdded -> phase: exploit
- ShellObtained -> phase: postexploit
- FlagCaptured (root) -> phase: report

## Infrastructure

### Mock target

A minimal Docker container that:
- Listens on ports 22, 80, 2049
- Returns version banners (nginx/1.24.0, OpenSSH 9.6p1)
- Serves a static web page with Server header
- Exports an NFS share with a test file

Dockerfile: `packages/containers/test-target/Dockerfile`

### Test harness

Vitest with `beforeAll`:
1. Start postgres (or use existing)
2. Create test engagement with mock target
3. Start supervisor with short stall timeout (10s)
4. Collect events for 30s
5. Assert expected events/discoveries/activity

### CI

GitHub Actions:
- Postgres service container
- Build mock target image
- Run integration tests
- Fail if any cascade step is missing

## Pentest playbook tests

Separate from supervisor integration. Test:
- Trigger matching for all pentest actions
- Phased execution (activate/drain/gate)
- The `runPhasedPentest` function
- Phase sequencing and skip logic

Use the existing `createMockContext` from the SDK for these (no real supervisor needed).
