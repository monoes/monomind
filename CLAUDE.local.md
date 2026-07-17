# Local Development Configuration

## Environment Variables

```bash
MONOMIND_CONFIG=./monomind.config.json
MONOMIND_LOG_LEVEL=info
MONOMIND_MEMORY_BACKEND=hybrid
MONOMIND_MEMORY_PATH=./data/memory
MONOMIND_MCP_PORT=3000
MONOMIND_MCP_TRANSPORT=stdio
```

## Doctor Health Checks

`npx monomind@latest doctor` checks: version freshness, Node 20+, npm, Claude Code CLI, git/git repo, config, memory DB, API keys, MCP servers, disk space, TypeScript build tools, monograph index + freshness, memory package, helpers freshness, monoes integration, guidance gates, gitignore coverage, agent registry, memory proficiency, worker metrics freshness, security audit findings.

## Hooks Quick Reference

```bash
npx monomind@latest hooks pre-task --description "[task]"
npx monomind@latest hooks post-task --task-id "[id]" --success true
npx monomind@latest hooks session-start --session-id "[id]"
npx monomind@latest hooks route --task "[task]"
npx monomind@latest hooks worker list
```

## Intelligence System

Trajectory + outcome logging (`intelligence.ts`); keyword routing (`createKeywordRouter`) with route-outcome correlation measured by `doctor`. Memory has three parallel backends: a JSON pattern store (hooks/intelligence trajectory logging), LanceDB + HF-embeddings (`memory-bridge.ts`, backs CLI `memory store/search` and MCP memory tools), and a standalone pure-JS HNSW index (`hnsw-operations.ts`) — not consolidated, see `packages/@monomind/memory/src/`.
