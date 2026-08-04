# Monomind Workflow Rules for Antigravity

## Knowledge Graph (Monograph)

- Before exploring code: call `mcp__monomind__monograph_suggest` with your task description.
- Before editing a symbol: call `mcp__monomind__monograph_impact` to see what breaks.
- For targeted lookups: call `mcp__monomind__monograph_query` (BM25 + PPR graph reranking).
- Only fall back to `grep`/`find` if monograph returns zero results.

## Memory

- Always call `mcp__monomind__memory_kg_search` at the start of a task.
- After a helpful search: call `mcp__monomind__memory_feedback` with result IDs.
- At session end: distill insights via `mcp__monomind__memory_kg_ingest`.

## Documents (Second Brain)

- User specs, handbooks, and notes are indexed locally.
- Use `mcp__monomind__knowledge_search` to retrieve them semantically.
- Results labeled `[global]` come from the user's personal cross-project brain.

## Statusline

- The Monomind status bar renders at the bottom of the agy chat window.
- It is driven by `.gemini/helpers/statusline.sh` → `.gemini/helpers/statusline.cjs`.
- Run `node .gemini/helpers/statusline.cjs` to see it in the terminal.
