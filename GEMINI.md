# Monomind for Antigravity (agy) — v2.8.0

> Monomind extends agy with a codebase knowledge graph (Monograph), persistent
> cross-session memory, semantic Second Brain document search, and autonomous
> agent organisations. All data stays local — nothing leaves your machine.

Behavioral rules live in `.gemini/rules/monomind.md` and are always enforced.

## Status Bar

The Monomind status bar is wired into agy via `.gemini/helpers/statusline.sh`.
It shows live: graph node count, stale-node count, agent routing, cost metrics,
and git state. The bar refreshes automatically whenever agy polls it.

To check system health at any time:
```bash
node .gemini/helpers/statusline.cjs
```

## MCP Tools — Quick Reference

| Category | Key Tools |
|---|---|
| **Knowledge Graph** | `monograph_suggest`, `monograph_query`, `monograph_impact`, `monograph_neighbors`, `monograph_context` |
| **Memory** | `memory_kg_search`, `memory_pattern-store`, `memory_feedback`, `memory_kg_ingest`, `memory_kg_search` |
| **Documents** | `knowledge_search`, `knowledge_ingest` |
| **Orgs** | `task_create`, `task_status`, `system_status` |

## Org Runtime

Run autonomous background agent teams:
```bash
monomind org run <name> --task "..."   # start daemon
monomind org status                    # check all orgs
monomind org questions <name>          # pending human questions
monomind org answer <name> <q-id> "…" # answer an agent question
```

Org role provider can be set to `gemini` in the org JSON:
```json
{ "provider": { "kind": "gemini", "apiKeyEnv": "GEMINI_API_KEY" } }
```
