# Monomind for Antigravity (agy) — v2.8.0

> Monomind extends agy with a codebase knowledge graph (Monograph), persistent
> cross-session memory, semantic Second Brain document search, and autonomous
> agent organisations. All data stays local — nothing leaves your machine.

## Behavioral Rules (Always Enforced)

- ALWAYS call `mcp__monomind__monograph_suggest` when starting a task touching 3+ files — it ranks files by task relevance and shows blast-radius before you touch anything.
- ALWAYS call `mcp__monomind__monograph_query` BEFORE running grep/find in the terminal — fall back to grep only if monograph returns zero results or the database does not exist.
- ALWAYS call `mcp__monomind__monograph_impact` before editing a class or exported symbol — it shows all upstream dependents.
- ALWAYS call `mcp__monomind__memory_search` before starting a task to recall past solutions, decisions, and architectural rules.
- After a memory search that actually helped: call `mcp__monomind__memory_feedback` with the entry IDs and quality score to train future ranking.
- At the end of a session that produced durable insight: call `mcp__monomind__memory_kg_ingest` once with the session ID as `originRef`.
- Use `mcp__monomind__knowledge_search` to query the project's indexed documents (specs, handbooks, notes) and the user's personal global brain.
- Do what has been asked; nothing more, nothing less.
- NEVER commit secrets, credentials, or .env files.
- NEVER create files unless they are absolutely necessary.
- ALWAYS prefer editing an existing file over creating a new one.

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
| **Memory** | `memory_search`, `memory_store`, `memory_feedback`, `memory_kg_ingest`, `memory_kg_search` |
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
