---
name: hive-mind:hive-mind-stop
---

# hive-mind shutdown

Clear hive workers from the shared agent store and reset hive state.

There is no `npx monomind hive-mind shutdown` CLI command — this is invoked
directly as an MCP tool call:

```javascript
mcp__monomind__hive-mind_shutdown({ graceful: true, force: false })
```

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `graceful` | boolean | `true` | If pending consensus items exist, refuse to shut down unless `force: true` |
| `force` | boolean | `false` | Override the graceful refusal above |

There is no interactive confirmation prompt (this is a direct tool call, not
a CLI), and no `saveState` option — consensus history is always kept,
shared memory is always cleared.

## Examples

```javascript
// Graceful shutdown — fails if there are pending consensus items
mcp__monomind__hive-mind_shutdown({})

// Force shutdown even with pending consensus items
mcp__monomind__hive-mind_shutdown({ force: true })
```

## Behavior

Removes all hive worker ids from the agent store, then resets hive state:
`initialized: false`, no queen, empty worker list, cleared pending consensus
and shared memory. Consensus history is retained on the state file. The
response includes `workersTerminated`, `previousQueen`, `consensusCleared`,
and a summary `message`.
