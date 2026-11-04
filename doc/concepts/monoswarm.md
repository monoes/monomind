# Monoswarm (removed)

Monoswarm and autopilot were removed in monomind 2.22.0
([#418](https://github.com/monoes/monomind/issues/418)). They recorded topology,
roster, vote and task state in local JSON files and started no agents.

What was removed:

- The `monomind monoswarm` and `monomind autopilot` CLI commands and all their
  subcommands.
- The 13 `monoswarm_*` and 8 `autopilot_*` MCP tools. MCP clients that call
  those tool names now get an unknown-tool error.
- The `monoswarm` skill, the `/monoswarm` commands, and the
  `coordinator-monoswarm-init` agent.

What to use instead:

- **Claude Code's Task tool** — spawn the agents you need in one message so they
  run in parallel. This is what did the work under monoswarm too.
- **`monomind org run <org>`** — run a standing team of roles with the Org
  Runtime (budgets, approvals, schedules, logs). See the `mastermind-createorg`
  and `mastermind-runorg` skills.

Migration notes:

- `monomind monoswarm ...` and `monomind autopilot ...` print what to use instead;
  they no longer record any state.
- Leftover `.swarm/` files are only the memory database location
  (`.swarm/memory.db`), which `monomind memory init` still uses.
- The `swarm` install pack still exists and holds hooks and workflow commands;
  it does not start swarms.
- Config keys that still carry the old name (for example `monoswarm.topology`)
  are read for compatibility only and have no runtime effect.
