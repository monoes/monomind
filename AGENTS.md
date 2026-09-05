# AGENTS.md — Monomind on opencode

Monomind is wired in as an MCP server (see opencode.json). Its tools are
available as the `monomind` server: `monograph_query`, `monograph_suggest`,
`monograph_impact`, `memory_pattern-search`, `memory_pattern-store`, and more.

## Code navigation — graph first
Call `monograph_query` / `monograph_suggest` BEFORE grep/rg/find for code
exploration. They return file path + line number from a SQLite knowledge graph.
Only fall back to grep if monograph returns nothing or the graph isn’t built.

The graph gate enforces this on hook-capable platforms: the first grep/search
in a session is blocked once until a monograph tool is called, then searches
pass with a reminder. Opt out: .monomind/guidance/active-gates.json
{"graphGate": "off"} or MONOMIND_GRAPH_GATE=off.

## Memory
Persist insights across sessions: `memory_pattern-store` to save, `memory_pattern-search` to
recall. Use namespacing to keep project/agent memory separate.

## Security
- NEVER hardcode secrets/keys in source. NEVER commit .env.
- Always validate input at system boundaries.
- Run `npx monomind@latest security scan` after security-related changes.

## Conventions
- Agents live in `.opencode/agent/` (subagents), commands in `.opencode/command/`.
- For multi-file work, spawn parallel subagents via the Task tool.
- Project-specific run/test/lint commands are in `.agents/shared_instructions.md`.

## Build & test
```bash
npm run build && npm test && npm run lint
```

# monomind:start instructions:opencode
# Monomind

Use the `monomind` MCP tools for graph navigation, impact analysis, memory, and organization work.
For multi-step work, load only the applicable `mastermind-*` skill; do not load all workflows at once.
If MCP is unavailable, run `npx -y monomind@latest doctor` and use `npx -y monomind@latest` commands.
# monomind:end instructions:opencode
# monomind:start instructions:codex
# Monomind

Use the `monomind` MCP tools for graph navigation, impact analysis, memory, and organization work.
For multi-step work, load only the applicable `mastermind-*` skill; do not load all workflows at once.
If MCP is unavailable, run `npx -y monomind@latest doctor` and use `npx -y monomind@latest` commands.
# monomind:end instructions:codex
