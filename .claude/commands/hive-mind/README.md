---
name: hive-mind:README
---

# Hive-Mind Commands

Queen-led consensus-based multi-agent coordination system. All operations use the `mcp__monomind__hive-mind_*` MCP tools.

## Commands (invoke as slash commands)

- [hive-mind](./hive-mind.md) — overview of all subcommands, topologies, and quick start
- [hive-mind-init](./hive-mind-init.md) — initialize hive with topology and consensus settings
- [hive-mind-spawn](./hive-mind-spawn.md) — spawn workers; `--claude` launches Claude Code as Queen
- [hive-mind-status](./hive-mind-status.md) — show hive status, workers, and metrics
- [hive-mind-stop](./hive-mind-stop.md) — shutdown the hive (the `shutdown` subcommand)
- [hive-mind-consensus](./hive-mind-consensus.md) — manage proposals and voting
- [hive-mind-memory](./hive-mind-memory.md) — access hive shared memory

## Real Subcommands (11 total)

```
init           Initialize hive with topology and consensus
spawn          Spawn workers; --claude launches Claude Code as Queen
status         Show status, workers, and metrics
task           Submit a task for distributed execution
join           Add an agent to the hive
leave          Remove an agent from the hive
consensus      Manage consensus proposals and voting
broadcast      Broadcast a message to all workers
memory         Access hive shared memory
optimize-memory Optimize memory patterns and consolidation
shutdown       Gracefully shutdown the hive
```

## Real Tools Used

- `mcp__monomind__hive-mind_init` / `hive-mind_spawn` / `hive-mind_status` — lifecycle
- `mcp__monomind__hive-mind_task` / `hive-mind_join` / `hive-mind_leave` — task and agent management
- `mcp__monomind__hive-mind_consensus` / `hive-mind_broadcast` — coordination
- `mcp__monomind__hive-mind_memory` / `hive-mind_optimize-memory` / `hive-mind_shutdown` — memory and shutdown
- `mcp__monomind__coordination_orchestrate` — cross-agent task distribution
- `mcp__monomind__memory_store` / `memory_retrieve` — global persistent memory
