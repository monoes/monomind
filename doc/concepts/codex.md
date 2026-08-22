# Codex

Monomind supports OpenAI Codex alongside Claude Code, Antigravity, OpenCode, and Kimi Code.

## Quickstart

```bash
npm install -g monomind
codex login
cd your-project
monomind init --target codex
```

Plain `monomind init` initializes every supported coding system. The `--target codex` form writes only the Codex integration. The legacy `--codex` flag is an alias.

## Generated files

| File | Purpose |
|---|---|
| `.codex/config.toml` | Project-scoped MCP configuration for `monomind@latest mcp start` |
| `AGENTS.md` | Codex instructions covering graph-first navigation, memory, security, and org runtime |
| `.agents/skills/` | Shared Monomind skills available to Codex and other compatible systems |

Codex loads `.codex/config.toml` only for trusted projects. If Codex does not show Monomind tools, trust the project and restart Codex.

## Persistent organizations

Set `runtime` to `codex` in an org definition to run roles through the local Codex CLI:

```json
{
  "name": "team",
  "runtime": "codex",
  "roles": [
    { "id": "developer", "reports_to": "boss", "runtime": "codex" }
  ]
}
```

Then run:

```bash
monomind org run team
```

Codex authentication comes from `codex login`; no additional API environment variable is required.
