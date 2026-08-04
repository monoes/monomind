# Antigravity (agy)

> Monomind's first non-Claude target: Google's [Antigravity](https://antigravity.google) CLI (`agy`). Unlike the opencode and Kimi Code targets, agy output is **on by default** — every `monomind init` emits it alongside the Claude config, no flag required. This page covers what you get and how the pieces fit together.

---

## Quickstart

```bash
npm install -g monomind
cd your-project
monomind init                   # emits .claude/ AND .gemini/ + GEMINI.md + AGENTS-shared instructions
```

Open the project in Antigravity. agy reads `GEMINI.md` (its `CLAUDE.md` equivalent), the rules file, and wires the monomind status bar via `.gemini/settings.json`. The monomind MCP server (knowledge graph, memory, swarm tools) is configured the same way as for Claude Code — agy supports the same `.mcp.json`:

```bash
agy mcp add monomind -- npx -y monomind@latest mcp start   # or reuse the existing .mcp.json
```

`monomind doctor --fix` confirms health.

---

## What you get

| Capability | How it shows up in agy |
|---|---|
| **Instructions** | `GEMINI.md` — behavioral rules (graph-first navigation, memory loop, security rules) plus the MCP quick reference. Written by `generateGeminiMd`; skip-if-exists. |
| **Workflow rules** | `.gemini/rules/monomind.md` — the Monograph/memory/documents rules in agy's rules format. |
| **Status bar** | `.gemini/helpers/statusline.sh` → `.gemini/helpers/statusline.cjs`, wired into agy via `.gemini/settings.json` (`statusLine: { type: 'command' }`). Shows graph node count, stale nodes, routing, cost, git state. agy polls it and renders stdout in the bar at the bottom of the chat window. |
| **Helpers** | The full `.claude/helpers/` tree is mirrored to `.gemini/helpers/` so agy-side hooks and the statusline resolve the same scripts Claude Code uses. |
| **MCP server + tools** | Same stdio server as every other target (`npx monomind@latest mcp start`) — 88 tools: `monograph_query`, `memory_kg_search`, … |
| **Global statusline** | If `~/.gemini/antigravity-cli/` already exists (you actually run agy), init also wires the statusline into the **global** agy settings. It never creates that directory — no global writes for non-agy users. |

---

## Org runtime — the `gemini` provider

Autonomous orgs (`monomind org run`) execute roles through the Claude Agent SDK by default, but a role can be pointed at Gemini models directly via the org JSON:

```json
{ "provider": { "kind": "gemini", "apiKeyEnv": "GEMINI_API_KEY" } }
```

The provider resolver sets `GEMINI_API_KEY` for that role's session and strips the Anthropic vars (and vice versa for other providers) — credentials are never stored in org JSON, only env var names. See [org-runtime](./org-runtime.md).

---

## How isolation works

- agy reads `.gemini/` and `GEMINI.md`; Claude Code reads `.claude/`; opencode reads `opencode.json` + `.opencode/`; Kimi Code reads `.kimi-code/`. They never touch each other's files.
- agy output is **not** behind a component flag (it's part of default init) — the opt-in flags are `--opencode` and `--kimicode`. `--skip-claude` skips the Claude tree; the agy tree is still emitted.
- The statusline wrapper delegates to `.gemini/helpers/statusline.cjs`, falling back to `.claude/helpers/statusline.cjs` — one implementation, two entry points.

For maintainer internals, see [`docs/opencode-architecture.md`](../../docs/opencode-architecture.md) — the agy target follows the same additive pattern (the agy generator is the older of the adaptation family; opencode and kimi were modeled on it).
