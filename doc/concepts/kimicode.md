# Kimi Code

> Monomind runs on [Kimi Code](https://www.kimi.com/code/) too — not just Claude Code, Antigravity, and opencode. `monomind init --kimicode` emits a `.kimi-code/` tree + `AGENTS.md` alongside (never instead of) your Claude/Antigravity config. This page covers what you get, the quickstart, and the current limitations.

---

## Quickstart

```bash
npm install -g monomind
cd your-project
monomind init --kimicode        # emits .kimi-code/ + AGENTS.md
```

Open the project in Kimi Code. The monomind MCP server (knowledge graph, memory, swarm tools) is wired in via `.kimi-code/mcp.json`, and `monomind doctor --fix` confirms health.

For slash commands and security gates, install the generated plugin once:

```
/plugins install ./.kimi-code/plugin
/reload
```

`--kimicode` is **additive**: it only writes kimi artifacts. If you also use Claude Code, Antigravity, or opencode, their `.claude/` / `.gemini/` / `.opencode/` output is unchanged. Default `monomind init` (no flag) does not emit kimi artifacts at all.

---

## What you get

| Capability | How it shows up in Kimi Code |
|---|---|
| **MCP server + tools** (Monograph graph, memory, hive-mind) | `.kimi-code/mcp.json` → `mcpServers.monomind`. Tools as `mcp__monomind__*` (`monograph_query`, `memory_search`, …). Merged into an existing mcp.json — your other servers are never clobbered, even with `--force`. |
| **Agents** | `.kimi-code/agents/*.md` — your agent roster (coder, reviewer, planner, …) as kimi sub-agents. Names are slugified to kebab-case, which kimi hard-requires. |
| **Skills** | `.kimi-code/skills/*/SKILL.md` — same SKILL.md shape Claude Code uses. |
| **Commands** | Two forms: (a) `.kimi-code/skills/<cat>-<name>/` as `type: flow` skills — invocable project-level via `/skill:<cat>-<name>` with zero install; (b) `.kimi-code/plugin/commands/*.md` — real `/monomind:*` slash commands once the plugin is installed. |
| **Security gates** | `.kimi-code/plugin/hooks/monomind-gate.mjs` — a bridge that runs monomind's existing pre-bash / pre-write gate handlers (destructive-op blocking, secret detection) through kimi's `PreToolUse` hook event. Active while the plugin is enabled; disabling the plugin disables enforcement. |
| **Instructions** | `AGENTS.md` (kimi's `CLAUDE.md` equivalent) + the shared `.agents/shared_instructions.md`, both auto-loaded. Skip-if-exists: a hand-written or opencode-generated AGENTS.md is never overwritten without `--force`. |
| **Status bar** | `~/.kimi-code/statusline.sh` + `[status_line].command` merged into `~/.kimi-code/tui.toml` (only when `~/.kimi-code/` already exists, i.e. you actually run kimi; your own `command` setting is never clobbered). Shows the monomind statusline under the chatbox — version, routing, git, swarm state — driven by the project's `.claude/helpers/statusline.cjs`. |

---

## Why commands exist twice

Kimi has **no project-level slash-command directory** — real `/plugin:command` commands only come from plugins, and plugins install per-user. So the same source commands are emitted in both forms: flow skills work immediately with no install, and the plugin adds the nicer `/monomind:*` namespace plus the hook gates. If a command slug collides with a real skill (e.g. `mastermind-debug`), the real skill wins at project level and the plugin command remains the command path.

---

## Requirements

- **Kimi Code CLI** 0.29+ (`kimi --version`), logged in (`/login`).
- **Node 22+**. The memory backend uses `better-sqlite3` v12, which ships prebuilt bindings for Node 22, 24, and 26 on darwin/linux/win (x64 + arm64). Older monomind installs pinned Node 22 because better-sqlite3 v11 could not build on Node 26 — that constraint is gone as of `@monoes/memory@1.0.14`.
- **Org runtime only:** the runner sets `KIMI_CODE_EXPERIMENTAL_FLAG=1` itself (kimi's `--agent-file` requires the v2 engine). You don't need to set it for `monomind org run`, but you do for your own `kimi --agent-file` usage.

---

## Org runtime (experimental)

`monomind org run` (autonomous agent organizations) has an `AgentRunner` abstraction so it is not hard-coupled to the Claude Agent SDK. Setting `MONOMIND_RUNTIME=kimicode` routes org sessions through `KimiCodeAgentRunner` instead of the default `ClaudeAgentRunner`:

```bash
MONOMIND_RUNTIME=kimicode monomind org run <name> --task "..."
```

> **How it works:** kimi has no embeddable SDK, so the runner drives the `kimi` CLI as a subprocess (`kimi -p … --output-format stream-json`), one invocation per turn, resuming the same session with `--session <id>`. Org tools (`org_send`, `knowledge_search`, …) travel over a **fence protocol**: the tools are rendered into the role's system prompt, the model emits ` ```tool_call ` JSON blocks, the runner executes the real handlers in-process and feeds results back into the same session. Token usage is read from the session's `wire.jsonl` (`usage.record` entries) since kimi's stream-json reports none. The Claude path is the default and is unchanged.

---

## How isolation works

Every kimi artifact is opt-in and additive:

- `monomind init` defaults have `components.kimicode = false` — standard init never emits kimi files.
- Kimi reads `.kimi-code/` and `AGENTS.md`; Claude Code reads `.claude/`; Antigravity reads `.gemini/`; opencode reads `opencode.json` + `.opencode/`. They never touch each other's files.
- The gate bridge only **spawns** monomind's existing `.claude/helpers/hook-handler.cjs` unchanged — it never edits it, so Claude Code's own hook path is unaffected. When the handler is absent, the bridge fails open (allows), matching both platforms' "hook errors never block" policy.
- The org runner is only constructed when `MONOMIND_RUNTIME=kimicode` is set; there is no new package dependency (it shells out to the `kimi` binary).

For the internal architecture, isolation guarantees, and the `AgentRunner` seam, see [`docs/kimicode-architecture.md`](../../docs/kimicode-architecture.md).
