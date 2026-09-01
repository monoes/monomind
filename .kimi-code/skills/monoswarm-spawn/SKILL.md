---
description: monoswarm spawn command (monomind)
type: flow
name: monoswarm-spawn
---

# monoswarm spawn

Write worker agent records into the agent store and register their ids on
the monoswarm state file (combines `agent_spawn` + `monoswarm_join`).

There is no `npx monomind monoswarm spawn` CLI command, and no `--claude`
flag that launches Claude Code as a lead process — this tool creates
bookkeeping entries only. No process, thread, or agent is started; real
concurrency comes from Claude Code's Task tool.

## MCP Tool

```javascript
mcp__monomind__monoswarm_agent_add({
  count: 5,
  role: "specialist",
  agentType: "coder",
  prefix: "monoswarm-worker"
})
```

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `count` | number | `1` | Number of workers to add (capped at 20 per call) |
| `role` | string | `worker` | Worker role: `worker`, `specialist`, `scout` |
| `agentType` | string | `worker` | Agent type for spawned workers (matches agent registry types) |
| `prefix` | string | `monoswarm-worker` | Prefix for generated worker IDs |

## Examples

```javascript
// Add 5 default workers
mcp__monomind__monoswarm_agent_add({ count: 5 })

// Add 3 specialists
mcp__monomind__monoswarm_agent_add({ count: 3, role: "specialist" })

// Add a coder-type worker with a custom ID prefix
mcp__monomind__monoswarm_agent_add({ agentType: "coder", prefix: "my-coder" })
```

Requires the run to already be initialized via `monoswarm_init` — the
handler returns `{ success: false }` otherwise.
