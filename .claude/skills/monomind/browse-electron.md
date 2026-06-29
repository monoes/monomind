---
name: monomind:browse-electron
description: Automate Electron desktop apps (VS Code, Slack, Discord, Figma, Notion, Spotify, etc.) using browser automation via Chrome DevTools Protocol. Use when the user needs to interact with an Electron app, automate a desktop app, connect to a running app, or test an Electron application.
version: 1.0.0
triggers:
  - automate electron
  - control vscode
  - interact with discord app
  - test electron app
  - connect to desktop app
  - electron desktop automation
  - automate slack desktop
tools:
  - Bash
requires:
  - monomind >= 1.0.0
---


# Electron App Automation (monomind:browse-electron)

Automate any Electron desktop app using monomind browse via Chrome DevTools Protocol (CDP). Electron apps are built on Chromium and expose a CDP port, enabling the same snapshot-interact workflow used for web pages.

See `monomind:browse` for the full browser automation reference.

## Core Workflow

1. **Launch** the Electron app with remote debugging enabled
2. **Connect** monomind browse to the CDP port
3. **Snapshot** to discover interactive elements
4. **Interact** using element refs
5. **Re-snapshot** after navigation or state changes

```bash
# Launch an Electron app with remote debugging
open -a "Slack" --args --remote-debugging-port=9222

# Connect monomind browse to the app
npx monomind browse open --port 0

# Standard workflow from here
npx monomind browse snapshot -i
npx monomind browse click @e5
npx monomind browse screenshot slack-desktop.png
```

## Launching with CDP

Every Electron app supports `--remote-debugging-port` since it's built into Chromium.

### macOS

```bash
open -a "Slack" --args --remote-debugging-port=9222
open -a "Visual Studio Code" --args --remote-debugging-port=9223
open -a "Discord" --args --remote-debugging-port=9224
open -a "Figma" --args --remote-debugging-port=9225
open -a "Notion" --args --remote-debugging-port=9226
open -a "Spotify" --args --remote-debugging-port=9227
```

### Linux

```bash
slack --remote-debugging-port=9222
code --remote-debugging-port=9223
discord --remote-debugging-port=9224
```

### Windows

```bash
"C:\Users\%USERNAME%\AppData\Local\slack\slack.exe" --remote-debugging-port=9222
"C:\Users\%USERNAME%\AppData\Local\Programs\Microsoft VS Code\Code.exe" --remote-debugging-port=9223
```

**Important:** If the app is already running, quit it first — the flag must be present at launch time.

## Connecting

```bash
# Connect to a specific port (persists for session)
npx monomind browse open --port 0

# Or pass --cdp on each command
npx monomind browse --cdp 9222 snapshot -i

# Auto-discover a running Chromium-based app
npx monomind browse --auto-connect snapshot -i
```

## Tab Management

Electron apps often have multiple windows or webviews:

```bash
npx monomind browse tab           # list all targets (windows, webviews)
npx monomind browse tab t2        # switch by stable id
npx monomind browse tab --url "*settings*"  # switch by URL pattern
```

## Webview Support

Electron `<webview>` elements appear as separate targets in the tab list:

```bash
npx monomind browse open --port 0
npx monomind browse tab
# 0: [page]    Slack - Main Window     https://app.slack.com/
# 1: [webview] Embedded Content        https://example.com/widget

npx monomind browse tab t2        # switch to webview
npx monomind browse snapshot -i
npx monomind browse click @e3
```

## Common Patterns

### Inspect and Navigate

```bash
open -a "Slack" --args --remote-debugging-port=9222
sleep 3
npx monomind browse open --port 0
npx monomind browse snapshot -i
npx monomind browse click @e10
npx monomind browse snapshot -i
```

### Screenshots

```bash
npx monomind browse open --port 0
npx monomind browse screenshot app-state.png
npx monomind browse screenshot --annotate annotated-app.png
```

### Extract Data

```bash
npx monomind browse open --port 0
npx monomind browse snapshot -i
npx monomind browse get text @e5
npx monomind browse snapshot --json > app-state.json
```

### Fill Forms

```bash
npx monomind browse open --port 0
npx monomind browse snapshot -i
npx monomind browse fill @e3 "search query"
npx monomind browse press Enter
npx monomind browse wait 1000
npx monomind browse snapshot -i
```

### Multiple Apps Simultaneously

```bash
npx monomind browse --session slack connect 9222
npx monomind browse --session vscode connect 9223

npx monomind browse --session slack snapshot -i
npx monomind browse --session vscode snapshot -i
```

## Color Scheme

```bash
npx monomind browse open --port 0
npx monomind browse --color-scheme dark snapshot -i
# or
AGENT_BROWSER_COLOR_SCHEME=dark npx monomind browse open --port 0
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Connection refused" | App not launched with `--remote-debugging-port`, or port mismatch |
| Connect fails after launch | Wait a few seconds — `sleep 3` before connect |
| Elements not in snapshot | Use `monomind browse tab` to switch to the right window/webview |
| Can't type in inputs | Try `monomind browse keyboard type "text"` or `keyboard inserttext "text"` |

## Supported Apps

Any Electron app: Slack, Discord, Teams, Signal, VS Code, GitHub Desktop, Postman, Figma, Notion, Obsidian, Spotify, Linear, 1Password, and more.
