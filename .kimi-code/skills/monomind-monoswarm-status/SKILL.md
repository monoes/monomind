---
description: monoswarm status command (monomind)
type: flow
name: monomind-monoswarm-status
---

# monoswarm status

Show monoswarm status: agent roster, task metrics, and (if voting is in
use) pending/history proposals.

```bash
npx monomind@latest swarm status
```

Or, for the fuller vote/consensus view, as an MCP tool call:

```javascript
mcp__monomind__monoswarm_status({ verbose: true })
```

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `verbose` | boolean | `false` | Include worker id list, recent vote history, and full shared-memory contents |

## Examples

```javascript
// Basic status
mcp__monomind__monoswarm_status({})

// Verbose: adds workerDetails, voteHistory, sharedMemory
mcp__monomind__monoswarm_status({ verbose: true })
```

## Output

Basic status includes:
- `runId`, `status` (`active` / `offline`), `topology`, `voteStrategy`
- `lead`: id, status, load, queued task count, elected-at, term
- `workers`: array of `{ id, type, status, tasksCompleted }` (`currentTask` is always `null` — the agent store has no such field)
- `metrics`: total/completed/active/pending task counts (real, sourced from the task store), `voteRounds`, `memoryUsage`
- `health`: overall/lead/workers/votes/memory status labels

`verbose: true` adds:
- `workerDetails` — raw worker id list
- `voteHistory` — last 10 vote decisions
- `sharedMemory` — full shared-memory object
