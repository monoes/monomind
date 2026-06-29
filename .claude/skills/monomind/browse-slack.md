---
name: monomind:browse-slack
description: Interact with Slack workspaces using browser automation. Use when the user needs to check unread channels, navigate Slack, send messages, extract data, search conversations, or automate any Slack task via the browser (not Slack API). Triggers include "check my Slack", "unread channels", "send a message to", "search Slack for", "find who said", or any browser-based Slack interaction.
version: 1.0.0
triggers:
  - check my slack
  - slack unreads
  - send message in slack
  - search slack
  - browse slack
  - navigate slack
  - extract from slack
  - slack automation
tools:
  - Bash
requires:
  - monomind >= 1.0.0
---


# Slack Browser Automation (monomind:browse-slack)

Interact with Slack workspaces via browser automation — no API keys or OAuth required. Uses the existing web session.

See `monomind:browse` for the full browser automation reference. For API-based Slack integration, use the `mcp__claude_ai_Slack__*` tools instead.

## Quick Start

```bash
# Connect to existing Slack browser session
npx monomind browse open --port 0

# Or open Slack fresh
npx monomind browse open https://app.slack.com

# Take a snapshot to see what's available
npx monomind browse snapshot -i
```

## Core Loop

```
Connect/Open → Snapshot -i → Navigate → Extract/Interact → Screenshot
```

## Common Tasks

### Check Unread Messages

```bash
npx monomind browse open --port 0
npx monomind browse snapshot -i

# Navigate to Activity tab (all unreads in one view)
npx monomind browse click @e14        # Activity tab
npx monomind browse wait 1000
npx monomind browse screenshot activity-unreads.png

# Or expand "More unreads" in sidebar
npx monomind browse click @e21        # More unreads button
npx monomind browse wait 500
npx monomind browse snapshot -i
npx monomind browse screenshot unreads.png
```

### Navigate to a Channel

```bash
npx monomind browse snapshot -i
# Find channel name in sidebar (treeitem elements)
npx monomind browse click @e94        # example channel ref
npx monomind browse wait --load networkidle
npx monomind browse screenshot channel.png
```

### Search Slack

```bash
npx monomind browse snapshot -i
npx monomind browse click @e5         # Search button
npx monomind browse fill @e_search "keyword"
npx monomind browse press Enter
npx monomind browse wait --load networkidle
npx monomind browse screenshot search-results.png
```

### Extract Channel Info

```bash
npx monomind browse snapshot --json > slack-snapshot.json
# Parse for treeitem elements (channel names) and listitem elements (messages)
```

### Send a Message

```bash
npx monomind browse click @e_channel  # open channel
npx monomind browse wait --load networkidle
npx monomind browse snapshot -i
npx monomind browse fill @e_composer "Hello from monomind!"
npx monomind browse press Enter
npx monomind browse wait 1000
npx monomind browse screenshot sent.png
```

### Scroll Through Messages

```bash
npx monomind browse scroll down 500 --selector ".p-message_list"
npx monomind browse snapshot -i
```

## Sidebar Layout

```
- Threads / Huddles / Drafts
- [Section Headers]
  - [Channels as treeitems]
- Direct Messages
- Apps
- [More unreads] button
```

Key tabs to look for: `@e12` Home, `@e13` DMs, `@e14` Activity, `@e5` Search, `@e21` More unreads (refs vary by session — always snapshot first).

## Data Extraction

```bash
# Text content of a message or element
npx monomind browse get text @e_message

# Full structured snapshot for parsing
npx monomind browse snapshot --json > output.json
# Look for: treeitem (channels), listitem/document (messages), button (users), link (timestamps)

# Count unread items after expanding unreads
npx monomind browse snapshot -i | grep -c "treeitem"
```

## Best Practices

- Connect to existing sessions (`connect 9222`) — faster than opening a new browser
- Always `snapshot -i` before clicking — refs vary per session
- Re-snapshot after navigation — new page means new refs
- Use `snapshot --json` when you need to parse structured data
- Add `wait 1000` between rapid interactions to let Slack's React UI update
- Scroll sidebar if channel list is long: `scroll down 300 --selector ".p-sidebar"`

## Limitations

- No Slack API access — browser automation only (cookies, no bot tokens)
- Workspace-specific — no cross-workspace automation
- May be slower than API for high-volume reads

## Debugging

```bash
npx monomind browse console       # browser console messages
npx monomind browse errors        # uncaught JS exceptions
npx monomind browse get url       # current URL
npx monomind browse screenshot page-state.png
```

## Full Unread Check Script

```bash
#!/bin/bash
npx monomind browse open --port 0
npx monomind browse snapshot -i

# Activity tab
npx monomind browse click @e14
npx monomind browse wait 1000
npx monomind browse screenshot activity.png

# DMs tab
npx monomind browse click @e13
npx monomind browse wait 1000
npx monomind browse screenshot dms.png

# More unreads
npx monomind browse click @e21
npx monomind browse wait 500
npx monomind browse snapshot -i
npx monomind browse screenshot unreads.png

echo "See activity.png, dms.png, unreads.png"
```
