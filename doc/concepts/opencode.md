# opencode

> Monomind runs on [OpenCode](https://opencode.ai) alongside Claude Code, Antigravity, Kimi Code, and Codex. Plain `monomind init` initializes every supported system; `monomind init --target opencode` initializes only OpenCode.

---

## Quickstart

```bash
npm install -g monomind
cd your-project
monomind init --target opencode # emits opencode.json + .opencode/ + AGENTS.md
```

Open the project in opencode. The monomind MCP server (knowledge graph, memory, swarm tools) is wired in via `opencode.json`, and `monomind doctor --fix` confirms health.

`--target opencode` is the single-system mode. Plain `monomind init` also emits OpenCode artifacts alongside the other supported coding systems. The legacy `--opencode` flag remains an alias for `--target opencode`.

---

## What you get

| Capability | How it shows up in opencode |
|---|---|
| **MCP server + tools** (Monograph graph, memory, monoswarm) | `opencode.json` → `mcp.monomind`. 88 tools as the `monomind` server (`monograph_query`, `memory_pattern-search`, …). |
| **Agents** | `.opencode/agent/*.md` — your agent roster (coder, reviewer, planner, …) as opencode subagents (`mode: subagent`). |
| **Commands** | `.opencode/command/*.md` — the `mastermind-*` workflows as opencode slash commands (flat namespace, e.g. `/mastermind-build`). |
| **Skills** | `.opencode/skills/*/SKILL.md` — same SKILL.md shape Claude Code uses. |
| **Security gates** | `.opencode/plugins/monomind-hooks.ts` — a plugin that runs monomind's existing pre-bash / pre-write gate handlers (destructive-op blocking, secret detection) inside opencode's `tool.execute.before`. |
| **Statusline data** | `/monomind-status` command — runs the monomind statusline and reports version, git, swarm, security, hooks, token cost. |
| **Instructions** | `AGENTS.md` (opencode's `CLAUDE.md` equivalent) + the shared `.agents/shared_instructions.md`, both auto-loaded. |

Permissions mirror Claude Code's allow/deny list (`bash` allow-rules for `npx monomind *`, `.env` read-deny).

---

## The `/monomind-status` command

opencode renders a built-in status panel (context / MCP / LSP) that is **not user-extensible** — there is no `statusLine` config and no statusbar plugin hook. So the persistent monomind status bar that appears under the chatbox in Claude Code / Antigravity has no direct equivalent.

Instead, run the command on demand:

```
/monomind-status
```

It executes `node .claude/helpers/statusline.cjs --compact` (with an `npx monomind hooks statusline` fallback) and prints a formatted summary. If you want the status always present in the agent's context, that requires an `experimental.chat.system.transform` plugin hook — not enabled by default because it re-runs the statusline each turn and costs tokens.

---

## Requirements

- **Node 22+**. The memory backend uses `better-sqlite3` v12 (mandatory since `@monoes/memory@1.0.14`), which ships prebuilt bindings for Node 22, 24, and 26 on darwin/linux/win (x64 + arm64). Older installs pinned Node 22 because better-sqlite3 v11 could not build on Node 26 — that constraint is gone. See [Memory > Troubleshooting](./memory.md).

---

## Org runtime (experimental)

`monomind org run` (autonomous agent organizations) has an `AgentRunner` abstraction so it is not hard-coupled to the Claude Agent SDK. Setting `MONOMIND_RUNTIME=opencode` routes org sessions through `OpencodeAgentRunner` instead of the default `ClaudeAgentRunner`.

> **Note:** opencode runs its agent loop in its own process (client/server), unlike Claude's in-process `query()`. The opencode runner spawns (or attaches to) an opencode server via `@opencode-ai/sdk` and drives it per-turn — verified against SDK 1.18.x. Org tools (`org_send`, …) travel over the same fence protocol as the kimi runner: the model emits ` ```tool_call ` blocks and the runner executes the real handlers in-process. The Claude path is the default and is unchanged.

---

## How isolation works

OpenCode artifacts are additive and isolated from the other platform configs:

- `monomind init` emits OpenCode by default; use `--target opencode` when only OpenCode should be initialized.
- opencode reads `opencode.json` and `.opencode/`; Claude Code reads `.claude/`; Antigravity reads `.gemini/`. They never touch each other's files.
- The hook-shim plugin only **spawns** monomind's existing `.claude/helpers/*.cjs` gate handlers unchanged — it never edits them, so Claude Code's own hook path is unaffected.

The internal architecture, isolation guarantees, and `AgentRunner` seam follow the same pattern as the other adapters in this family.
