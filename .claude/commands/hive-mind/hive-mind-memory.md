---
name: hive-mind:hive-mind-memory
---

# hive-mind memory

Access and manage hive shared memory — a key-value blob on the hive state
file, readable/writable by all agents coordinating in the current hive.

There is no `npx monomind hive-mind memory` CLI command — this is invoked
directly as an MCP tool call (see below).

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `action` | string | `list` | Action: `get`, `set`, `delete`, `list` |
| `key` | string | — | Memory key (required for `get`, `set`, `delete`) |
| `value` | any | — | Value to store (required for `set`) |

## Examples

```javascript
// List all keys in shared memory
mcp__monomind__hive-mind_memory({ action: "list" })

// Store a value
mcp__monomind__hive-mind_memory({ action: "set", key: "project-goal", value: "Build auth module" })

// Retrieve a value
mcp__monomind__hive-mind_memory({ action: "get", key: "project-goal" })

// Delete a key
mcp__monomind__hive-mind_memory({ action: "delete", key: "project-goal" })
```

## Actions

- **`list`** — Show all keys currently in shared memory with count (default)
- **`get`** — Retrieve the value at a key (requires `key`)
- **`set`** — Store a value at a key (requires `key` and `value`)
- **`delete`** — Remove a key from shared memory (requires `key`)

## Relationship to `monomind memory`

`hive-mind memory` operates on the **hive's shared memory namespace** — a
single JSON blob on the hive state file, visible to all agents coordinating
in the current hive. This is distinct from the global memory tools
(`memory_pattern-store` / `memory_pattern-search` / CLI `monomind memory`), which are
backed by local SQLite (with `sql.js`/WASM as a fallback) — not LanceDB,
which has been fully removed from this codebase.

Use hive memory for transient inter-agent coordination data (task results, intermediate state). Use global memory for patterns and knowledge that should persist across sessions.
