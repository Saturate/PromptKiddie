# Auto-log every command run in the tooling container
# Appended to /root/.bashrc at container build time

PROMPT_COMMAND='
if [ -n "$BASH_COMMAND" ] && [ "$BASH_COMMAND" != "$PROMPT_COMMAND" ]; then
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"cmd\":\"$(history 1 | sed "s/^[ ]*[0-9]*[ ]*//" | sed "s/\"/\\\\\"/g")\"}" >> /workspace/.tool-log/commands.jsonl 2>/dev/null
fi'

mkdir -p /workspace/.tool-log
