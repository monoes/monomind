---
name: monoes:monoclip
description: Drive mono-clip's CLI sidecar (`mclip`) — read/write clipboard history and folders, or run its MCP stdio server
---

# monoes monoclip

Interact with **mono-clip** — a macOS menu-bar clipboard manager (Tauri + SvelteKit, app bundle `MonoClip.app`). The GUI app itself has **no CLI flags, deep-link scheme, or HTTP/IPC surface** — the only scriptable surface is a separate sidecar binary, **`mclip`**, that talks directly to the same SQLite database the GUI reads/writes (`~/.monoclip/monoclip.db`). `mclip` works whether or not the GUI is currently running, as long as the app has been launched at least once (so the DB exists).

Not installed, or `mclip` not on PATH? Run `/monoes:install` first — after installing `mono-clip.app`, launch it once (its own startup hook symlinks `mclip` into `~/.local/bin/mclip`), then make sure `~/.local/bin` is on `PATH`.

## Command tree

```
mclip list [--folder NAME] [--search QUERY] [--limit N]
mclip add "text" [--folder NAME]
mclip get <id>                     # prints raw content — pipeable, e.g. mclip get 7 | pbcopy
mclip remove <id>
mclip pin <id> / unpin <id>

mclip folder list
mclip folder add "Name" [--icon ICON --color COLOR]
mclip folder remove "Name"

mclip context                       # prints a canned AI-context block (for pasting into CLAUDE.md/.cursorrules)
mclip mcp                           # starts a JSON-RPC-over-stdio MCP server (see below)
```

## Examples

```bash
# Save something to a folder, then recall it
mclip add "ssh user@example.com" --folder "Snippets"
mclip list --folder "Snippets"

# Pull a clip straight into the system clipboard
mclip get 12 | pbcopy

# Pin an important clip so auto-cleanup never removes it
mclip pin 12

# Organize folders
mclip folder add "Work" --icon "briefcase" --color "#4287f5"
mclip folder list
```

## MCP server mode

`mclip mcp` starts a hand-rolled JSON-RPC-over-stdio MCP server exposing: `list_clips`, `add_clip`, `get_clip`, `remove_clip`, `pin_clip`, `list_folders`, `create_folder`, `delete_folder`. To use it from an MCP client (e.g. Claude Desktop), register it as a stdio server with `"command": "mclip", "args": ["mcp"]` in that client's config — this is a separate integration path from shelling out to individual `mclip` subcommands above, and mostly relevant outside Claude Code itself (which already has direct Bash access to `mclip`).

## What this app is (for context, not directly scriptable)

Menu-bar-only clipboard manager: background watcher (polls every 300ms), auto-detects content type (text/url/email/color/code), multi-folder organization with per-folder global shortcuts (press hotkey → captures selection straight into that folder), a master shortcut (`⌘⇧V` default) toggling a floating panel, pin/soft-delete, image & file-path capture with thumbnails, search, configurable auto-cleanup retention (always keeps the last 10 Inbox items), local-only SQLite storage, no network/telemetry, self-update.

## Gotchas (verified against source)

- There is genuinely no way to control the running GUI app from outside it — no deep link (`monoclip://...`), no HTTP/Unix-socket API (that's on the project's own TODO list, not implemented), no `tauri-plugin-cli`. Don't invent flags for the main `monoclip`/`MonoClip.app` binary — everything scriptable lives in `mclip`.
- `mclip` requires the app to have been launched at least once (so `~/.monoclip/monoclip.db` exists) — a fresh install with the GUI never opened will fail.
- If `mclip` isn't found after install, it's almost always a `PATH` issue — the symlink at `~/.local/bin/mclip` is created automatically on first GUI launch (or via the GUI's Settings → "Install mclip CLI"), but `~/.local/bin` isn't always on `PATH` by default.

## See Also

- `/monoes:install` — install mono-clip if `MonoClip.app` / `mclip` aren't found
- `../mono-clip/README.md` — Homebrew cask / build-from-source instructions
