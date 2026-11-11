# Kiosk Escape via Browser Save As Dialog

## When to use

- Target runs a locked kiosk (Chromium kiosk mode, Electron app, or similar)
- Kiosk has a way to trigger an external URL or error dialog that opens a second browser
- The second browser (Edge, IE, Firefox) has standard UI including Save As dialogs
- Goal: break out of kiosk to get a command prompt or file system access

## Tags

- ATT&CK: T1546 (Event Triggered Execution), T1574 (Hijack Execution Flow)
- Platform: Windows
- Services: RDP, kiosk applications
- Privileges: kiosk user (low-privilege, restricted shell)

## How it works

Kiosk-mode browsers disable address bars, menus, and keyboard shortcuts. But if the
kiosk application triggers an external URL (error page, support link, OAuth redirect),
Windows opens it in the default browser - which is NOT in kiosk mode. From a normal
browser window, the Save As dialog (`Ctrl+S`) exposes a file browser with an address
bar that can navigate to `C:\Windows\System32\cmd.exe` or launch arbitrary executables.

## Triggering the external browser

Look for any UI element that opens a URL outside the kiosk app:

- **Error dialogs** with "Learn more" or support links
- **OAuth/SSO redirects** to external identity providers
- **Help links** in footer or about pages
- **QR codes** or deep links that resolve to http:// URLs
- **PDF viewers** with "Open in browser" options
- **Device/hardware errors** that display troubleshooting URLs

On Touch, powering off a scanner via the DeviceHub API caused an error dialog with
an external support URL. Clicking it opened Edge.

## Escaping to cmd.exe

Once in a normal browser window:

1. Press `Ctrl+S` to open Save As dialog
2. In the address bar of the Save As dialog, type: `C:\Windows\System32\cmd.exe`
3. Press Enter - cmd.exe launches outside the kiosk context

Alternative paths from Save As:
- Navigate to `C:\Windows\System32\` and right-click `cmd.exe` > Open
- Type `\\localhost\c$\Windows\System32\cmd.exe` for UNC path
- Use `powershell.exe` instead of `cmd.exe`

## Operational notes

**Ctrl+S might be blocked.** Some kiosks intercept keyboard shortcuts even in the
secondary browser. Try `F12` (DevTools) > Console > `window.open('file:///C:/')` as
an alternative. Or use `Ctrl+O` (Open) instead of Save As.

**Group Policy restrictions.** Well-configured kiosks use AppLocker or WDAC to block
cmd.exe/powershell.exe execution. Check for bypass paths: `C:\Windows\System32\bash.exe`
(WSL), scripting hosts (`cscript.exe`, `wscript.exe`), or writable directories not
covered by policy.

**File browser navigation.** The Save As dialog's address bar supports environment
variables: `%SYSTEMROOT%\System32\cmd.exe` works if the full path is blocked.

## Proven on

- Windows 11 Pro, Chromium kiosk + Edge escape (HTB Touch, 2026-10-03): DeviceHub scanner error dialog opened Edge, Ctrl+S Save As to cmd.exe
