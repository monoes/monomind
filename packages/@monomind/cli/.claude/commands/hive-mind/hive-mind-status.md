---
name: hive-mind:hive-mind-status
---

# hive-mind status

Show hive mind status including queen, workers, and task/consensus metrics.

There is no `npx monomind hive-mind status` CLI command — this is invoked
directly as an MCP tool call:

```javascript
mcp__monomind__hive-mind_status({ verbose: true })
```

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `verbose` | boolean | `false` | Include worker id list, recent consensus history, and full shared-memory contents |

## Examples

```javascript
// Basic status
mcp__monomind__hive-mind_status({})

// Verbose: adds workerDetails, consensusHistory, sharedMemory
mcp__monomind__hive-mind_status({ verbose: true })
```

## Output

Basic status includes:
- `hiveId`, `status` (`active` / `offline`), `topology`, `consensus`
- `queen`: id, status, load, queued task count, elected-at, term
- `workers`: array of `{ id, type, status, tasksCompleted }` (`currentTask` is always `null` — the agent store has no such field)
- `metrics`: total/completed/active/pending task counts (real, sourced from the task store), `consensusRounds`, `memoryUsage`
- `health`: overall/queen/workers/consensus/memory status labels

`verbose: true` adds:
- `workerDetails` — raw worker id list
- `consensusHistory` — last 10 consensus decisions
- `sharedMemory` — full shared-memory object
