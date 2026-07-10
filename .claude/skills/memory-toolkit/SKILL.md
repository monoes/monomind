---
name: memory-toolkit
description: >
  Use monomind's persistent memory store (LanceDB + pure-JS HNSW) to save,
  search, list, and retrieve cross-session knowledge — patterns, solutions,
  decisions. Trigger on "remember this", "store in memory", "search memory",
  "have we solved this before", "recall past decisions", or before starting
  work that benefits from prior context (debugging, refactors, repeated tasks).
---

# Memory Toolkit

Monomind ships a persistent, namespaced memory store backed by LanceDB with
a pure-JS HNSW index for approximate nearest-neighbor vector search. Use it
to avoid re-solving the same problem twice across sessions.

## Before starting non-trivial work

Search for prior art first:

```bash
npx monomind memory search --query "[task keywords]" --namespace patterns
npx monomind memory search --query "[task keywords]" --namespace solutions
```

## Store data

```bash
# REQUIRED: --key and --value. OPTIONAL: --namespace (default: "default"), --ttl, --tags
npx monomind memory store --key "pattern-auth" --value "JWT with refresh tokens" --namespace patterns
npx monomind memory store --key "bug-fix-123" --value "Fixed null check in parser" --namespace solutions --tags "bugfix,auth"
```

## Search data (semantic / keyword / hybrid)

```bash
# REQUIRED: --query. OPTIONAL: --namespace, --limit, --threshold, --type
npx monomind memory search --query "authentication patterns"
npx monomind memory search --query "JWT" --type keyword
npx monomind memory search --query "error handling" --namespace patterns --limit 5
```

| Search type | Description                  | Best for                  |
| ----------- | ----------------------------- | -------------------------- |
| `semantic`  | Vector similarity search       | Concept / meaning matching |
| `keyword`   | BM25 full-text search          | Exact term matching        |
| `hybrid`    | Combined semantic + keyword    | General purpose (default)  |

Use `--build-hnsw` before searching large memory stores (1,000+ entries) —
it builds a pure-JS HNSW index for O(log n) queries instead of O(n) linear
scan (one-time build cost).

## List and retrieve

```bash
npx monomind memory list --namespace patterns --limit 10
npx monomind memory retrieve --key "pattern-auth" --namespace patterns
```

## MCP equivalents

```javascript
mcp__monomind__memory_store({ key: "pattern-auth", value: "...", namespace: "patterns" })
mcp__monomind__memory_search({ query: "authentication patterns", namespace: "default", limit: 10, threshold: 0.7, type: "hybrid" })
```

## After completing non-trivial work

Store what worked so the next session (or agent) doesn't start from zero:

```bash
npx monomind memory store --key "[short-name]" --value "[what worked and why]" --namespace patterns
```

See also: `.claude/commands/memory/memory-search.md` for the full flag reference.
