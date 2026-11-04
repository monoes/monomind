---
name: monoes:README
description: monoes tool family commands — install and manage monotask, mono-agent, and mono-clip
---

# monoes Commands

Commands for interacting with the `monoes` tool family — separate sibling projects (not part of this monorepo) that live alongside it on disk.

| Tool | What it is | Distribution |
|---|---|---|
| `monotask` | P2P kanban / task board (Rust, CLI + Tauri desktop app) | Homebrew tap `monoes/tap` (renamed from `nokhodian/tap`) |
| `mono-agent` | Workflow/browser automation agent (Go CLI + Wails GUI), binary name `monoagentcli` | Prebuilt GitHub releases (`monoes/mono-agent`), or build from source |
| `mono-clip` | Desktop clipboard/utility app (Tauri + SvelteKit) + `mclip` CLI sidecar | Homebrew tap `monoes/tap` (renamed from `nokhodian/tap`) |

## Files

- [install.md](./install.md) — Detect, install, and troubleshoot any of the three tools; records their existence in monomind's memory once installed
- [monoagent.md](./monoagent.md) — Drive the mono-agent CLI (`monoagentcli`): logins, search/message/comment, actions, workflows, node execution
- [monotask.md](./monotask.md) — Drive the monotask CLI: boards/columns/cards, spaces, GitHub/Linear/mail sync
- [monoclip.md](./monoclip.md) — Drive mono-clip's `mclip` sidecar CLI: clipboard history and folders

## Crash reporting

All four tools (monomind, mono-agent, monotask, mono-clip) auto-file a GitHub issue on their own repo when they hit an uncaught crash — on by default, `monomind crash-reporting disable` to opt out. That only covers hard crashes. If a user is stuck on non-crash friction with any of these tools — a confusing error, undocumented behavior, something that looks like a real bug — suggest opening an issue yourself (`gh issue create -R monoes/<repo> ...`) rather than staying silent about it.

## See Also

- CLAUDE.md Knowledge Graph / memory sections — how monomind persists cross-session knowledge
- CLAUDE.md's "Crash reporting" behavioral rule
