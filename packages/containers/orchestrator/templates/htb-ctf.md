# Orchestrator: HTB CTF

## HTB CLI

```bash
# List challenges
htb challenges list --json

# Unsolved only
htb challenges list --json | jq '[.[] | select(.is_owned == false)]'

# Unsolved by category
htb challenges list --json | jq '[.[] | select(.is_owned == false)] | group_by(.category_name) | map({category: .[0].category_name, count: length}) | sort_by(-.count)'

# Unsolved web with spawn instances
htb challenges list --json | jq '[.[] | select(.is_owned == false and .category_name == "Web" and (.play_methods | index("spawn")))] | sort_by(.solves)'

# Spawn / submit
htb challenges start <id>
htb challenges submit <id> 'HTB{...}'
```

## PK engagement flow

For each challenge that needs attack infrastructure:

```bash
pk create_engagement --name "<challenge>" --type ctf
pk add_target --engagement <id> --identifier <ip:port> --in-scope true
pk add_objective --engagement <id> --title "Capture flag"
pk set_engagement_status --engagement <id> --status active

# During execution
pk advance_phase          # recon → enum → exploit
pk add_finding --title "..." --severity high
pk add_service --port 80 --service http
pk log_activity --message "..."

# On flag
pk capture_flag --engagement <id> --flag "HTB{...}"
htb challenges submit <challenge_id> 'HTB{...}'
pk set_engagement_status --engagement <id> --status done
```

## Writeups

After each solve, write `.pk/writeups/<challenge-name>.md`:

```markdown
# <Challenge Name> (<category>, <difficulty>)

## TL;DR
One sentence.

## Steps
Commands and output.

## Flag
`HTB{...}`
```

## Notes

- Challenges with `is_owned: true` are already solved, skip them
- `play_methods: ["spawn"]` means a live instance, good for PK engagements
- `play_methods: ["download"]` means files to analyze, may not need PK
- Flag format: `HTB{...}`
