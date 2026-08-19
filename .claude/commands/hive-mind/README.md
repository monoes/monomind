---
name: hive-mind:README
---

# Hive-Mind Commands

Queen-led consensus-based multi-agent coordination system. There is no
`npx monomind hive-mind` CLI subcommand — all operations use the
`mcp__monomind__hive-mind_*` MCP tools directly.

## Commands (invoke as slash commands)

- [hive-mind](./hive-mind.md) — overview of all 11 tools, topologies, and quick start
- [hive-mind-init](./hive-mind-init.md) — initialize hive with topology and consensus settings
- [hive-mind-spawn](./hive-mind-spawn.md) — register worker agent records into the hive
- [hive-mind-status](./hive-mind-status.md) — show hive status, workers, and metrics
- [hive-mind-stop](./hive-mind-stop.md) — shut down the hive (the `shutdown` tool)
- [hive-mind-consensus](./hive-mind-consensus.md) — manage proposals and voting
- [hive-mind-memory](./hive-mind-memory.md) — access hive shared memory

## Real Tools (11 total)

```
hive-mind_init            Create the hive state file (topology, consensus, empty worker list)
hive-mind_spawn           Register worker records into the agent store and hive
hive-mind_status          Read hive status: queen, workers, task/consensus metrics
hive-mind_join            Add an existing agent id to the hive's worker list
hive-mind_leave           Remove an agent id from the hive's worker list
hive-mind_consensus       Propose/vote/check status on threshold-based decisions
hive-mind_broadcast       Write a message into the hive's shared memory
hive-mind_memory          Get/set/delete/list keys in the hive's shared memory
hive-mind_audit_list      List signed consensus decision records
hive-mind_audit_verify    Verify a consensus decision's vote/record signatures
hive-mind_shutdown        Clear hive workers from the agent store, reset hive state
```

## Real Tools Used

- `mcp__monomind__hive-mind_init` / `hive-mind_spawn` / `hive-mind_status` — lifecycle
- `mcp__monomind__hive-mind_join` / `hive-mind_leave` — worker membership
- `mcp__monomind__hive-mind_consensus` / `hive-mind_broadcast` — coordination
- `mcp__monomind__hive-mind_audit_list` / `hive-mind_audit_verify` — decision-record auditing
- `mcp__monomind__hive-mind_memory` / `hive-mind_shutdown` — shared memory and shutdown
