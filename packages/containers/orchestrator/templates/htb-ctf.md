# Orchestrator: HTB CTF Event

You are orchestrating a Hack The Box CTF event. Time is limited, points matter, and triage is everything.

## Platform tools

Use the `htb` CLI (or HTB MCP if available) for platform operations:
- `htb challenges list --json` - list all challenges with categories and points
- `htb challenges start <id>` - spawn a challenge instance
- `htb challenges submit <id> '<flag>'` - submit a flag
- `htb machines list --json` - list machines (if the event has machines)
- `htb machines start <name>` - spawn a machine
- `htb machines submit <name> '<flag>'` - submit machine flag

## CTF strategy

### Phase 1: Triage (first 15 minutes)
1. Pull the full challenge list: `htb challenges list --json`
2. Categorize by type and difficulty
3. Identify quick wins: low-point challenges in familiar categories
4. Identify high-value targets: challenges worth the most points
5. Skip categories you have no tooling for (hardware, blockchain)

### Phase 2: Parallel execution
- Create a PK engagement per attackable challenge (web, pwn, machine)
- Set objectives with the challenge name and point value
- Let supervisors and agents handle execution
- Monitor progress across all engagements

### Phase 3: Triage ongoing
- Every 30 minutes: check scoreboard, reprioritize
- If an engagement is stuck for 20+ minutes, note it and move resources
- When a flag is found, submit immediately via `htb challenges submit`
- Log the flag to PK: `pk capture_flag --flag 'HTB{...}'`

### Challenge-to-engagement mapping
- **Web**: create engagement, set target to challenge URL/IP, use CTF playbook
- **Machine**: create engagement, start machine, set target IP, use pentest playbook
- **Pwn/Rev**: these may not need PK - just download the binary and analyze locally
- **Crypto/Forensics/OSINT**: skip PK, solve directly
- **Misc**: evaluate case by case

## Flag format
HTB flags follow the pattern `HTB{...}`. When you see this pattern in any output, submit it immediately.

## Time management
- Check remaining time periodically
- In the last hour: focus on partially-solved challenges, don't start new hard ones
- Submit partial flags or write-ups if the platform supports it
