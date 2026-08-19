---
name: hive-mind:hive-mind-spawn
---

# hive-mind spawn

Write worker agent records into the agent store and register their ids on
the hive state file (combines `agent_spawn` + `hive-mind_join`).

There is no `npx monomind hive-mind spawn` CLI command, and no `--claude`
flag that launches Claude Code as a "Queen" process — this tool creates
bookkeeping entries only. No process, thread, or agent is started; real
concurrency comes from Claude Code's Task tool.

## MCP Tool

```javascript
mcp__monomind__hive-mind_spawn({
  count: 5,
  role: "specialist",
  agentType: "coder",
  prefix: "hive-worker"
})
```

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | number | `1` | Number of workers to spawn (capped at 20 per call) |
| `role` | string | `worker` | Worker role: `worker`, `specialist`, `scout` |
| `agentType` | string | `worker` | Agent type for spawned workers (matches agent registry types) |
| `prefix` | string | `hive-worker` | Prefix for generated worker IDs |

## Examples

```javascript
// Spawn 5 default workers
mcp__monomind__hive-mind_spawn({ count: 5 })

// Spawn 3 specialists
mcp__monomind__hive-mind_spawn({ count: 3, role: "specialist" })

// Spawn a coder-type worker with a custom ID prefix
mcp__monomind__hive-mind_spawn({ agentType: "coder", prefix: "my-coder" })
```

Requires the hive to already be initialized via `hive-mind_init` — the
handler returns `{ success: false }` otherwise.
