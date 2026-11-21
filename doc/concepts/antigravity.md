# Antigravity (agy)

> Monomind supports Google's [Antigravity](https://antigravity.google) CLI (`agy`) alongside Claude Code, OpenCode, Kimi Code, and Codex. `monomind init` sets up the coding systems it finds installed; `monomind init --target antigravity` initializes only Antigravity.

---

## Quickstart

```bash
npm install -g monomind
cd your-project
monomind init                   # initializes the coding systems it finds installed
monomind init --target antigravity # initializes only Antigravity
```

Open the project in Antigravity. agy reads `GEMINI.md` (its `CLAUDE.md` equivalent), the rules file, and wires the monomind status bar via `.gemini/settings.json`. `init` writes the monomind MCP server (knowledge graph, memory, picking and design tools) only to `.mcp.json`, Claude Code's project file; it writes no Antigravity MCP config. Register the server in Antigravity's own MCP configuration: its docs name a workspace `.agents/mcp_config.json` (global: `~/.gemini/config/mcp_config.json`) with an `mcpServers` map. Copy the `command` and `args` of the `monomind` entry from `.mcp.json`, which pin the version that ran `init`.

`monomind doctor --fix` confirms health.

---

## What you get

| Capability | How it shows up in agy |
|---|---|
| **Instructions** | `GEMINI.md` — behavioral rules (graph-first navigation, memory loop, security rules) plus the MCP quick reference. Written by `generateGeminiMd` inside a managed `<!-- monomind-block:gemini-md -->` block, the same edit-preserving merge `CLAUDE.md`/`AGENTS.md` use: your text outside the block is kept, `--force` refreshes only monomind's block. |
| **Workflow rules** | `.gemini/rules/monomind.md` — the Monograph/memory/documents rules in agy's rules format. |
| **Status bar** | `.gemini/helpers/statusline.sh` → `.gemini/helpers/statusline.cjs`, wired into agy via `.gemini/settings.json` (`statusLine: { type: 'command' }`). Shows graph node count, stale nodes, routing, cost, git state. agy polls it and renders stdout in the bar at the bottom of the chat window. |
| **Helpers** | When Antigravity is selected (by default when it is detected, and always under `--target all`), the full `.claude/helpers/` tree is mirrored to `.gemini/helpers/` so the statusline resolves the same scripts Claude Code uses. No other platform reads this copy, so `init` without Antigravity does not write it (an existing copy is left in place). `--target antigravity` alone installs no Claude helpers, so this copy is then the only one. `init upgrade` refreshes this copy the same way it refreshes `.claude/helpers`, and `doctor` warns when it is stale. |
| **MCP server + tools** | Same stdio server as every other target (`monomind mcp start` through npx, pinned to the version that ran `init`), written to `.mcp.json` only; register it in Antigravity's MCP config yourself (see Quickstart) — <!-- doc-count:mcp-tools-default -->21<!-- /doc-count:mcp-tools-default --> tools by default (<!-- doc-count:mcp-tools-full -->204<!-- /doc-count:mcp-tools-full --> with `MONOMIND_MCP_FULL=1`): `monograph_query`, `memory_kg_search`, … |
| **Global statusline** | Not written. `init` is project-scoped: it does not touch `~/.gemini/antigravity-cli/`, even when that directory exists. |

---

## Org runtime — running roles on Gemini

Autonomous orgs (`monomind org run`) execute roles through the Claude Agent SDK by default. To run a role on Gemini, either set `"runtime": "antigravity"` on the role (or the org), which drives the `agy` CLI, or call Gemini models directly through the Vercel AI SDK runner:

```json
{ "provider": { "kind": "vercel-api-key", "vendor": "google", "apiKeyEnv": "GEMINI_API_KEY" } }
```

`provider.kind: "gemini"` is deprecated: it only sets `GEMINI_API_KEY` for the session, no runtime reads it, and the role still runs on Claude (`org run` prints a warning at start). Credentials are never stored in org JSON, only env var names. See [org-runtime](./org-runtime.md).

---

## How isolation works

- agy reads `.gemini/` and `GEMINI.md`; Claude Code reads `.claude/`; opencode reads `opencode.json` + `.opencode/`; Kimi Code reads `.kimi-code/`. Each target also gets `.claude/skills/`, the copy the other platforms' skill directories are made from.
- `monomind init` emits agy output when Antigravity is detected (`gemini`, `agy` or `antigravity` on your `PATH`, or `~/.gemini` / `~/.antigravity`). Use `--target antigravity` for Antigravity only; `--target claude` for Claude only. `--skip-claude` remains the legacy runtime-only mode.
- The statusline wrapper delegates to `.gemini/helpers/statusline.cjs`, falling back to `.claude/helpers/statusline.cjs` — one implementation, two entry points.

The agy target follows the same additive pattern as the other adapters in this family (the agy generator is the oldest; opencode and kimi were modeled on it).
