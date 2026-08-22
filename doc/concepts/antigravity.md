# Antigravity (agy)

> Monomind supports Google's [Antigravity](https://antigravity.google) CLI (`agy`) alongside Claude Code, OpenCode, Kimi Code, and Codex. Plain `monomind init` initializes every supported system; `monomind init --target antigravity` initializes only Antigravity.

---

## Quickstart

```bash
npm install -g monomind
cd your-project
monomind init                   # initializes all supported coding systems
monomind init --target antigravity # initializes only Antigravity
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
- `monomind init` emits agy output by default. Use `--target antigravity` for Antigravity only; `--target claude` for Claude only. `--skip-claude` remains the legacy runtime-only mode.
- The statusline wrapper delegates to `.gemini/helpers/statusline.cjs`, falling back to `.claude/helpers/statusline.cjs` — one implementation, two entry points.

The agy target follows the same additive pattern as the other adapters in this family (the agy generator is the oldest; opencode and kimi were modeled on it).
