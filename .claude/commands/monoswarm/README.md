---
name: monoswarm-README
description: Monoswarm skill index — lists all available multi-agent coordination and vote-consensus skills for Monomind
---

# Monoswarm Skills

Multi-agent swarm coordination, with optional vote-based consensus, for Monomind.

## Core Skills

- [monoswarm](./monoswarm.md) — Main skill: how to start and coordinate a run, plus the vote/consensus tool reference

## Strategy Skills

- [analysis](./analysis.md) — Distributed analysis via coordinated agents
- [development](./development.md) — Coordinated development teams
- [research](./research.md) — Parallel information gathering
- [testing](./testing.md) — Distributed test execution
- [maintenance](./maintenance.md) — System maintenance coordination
- [optimization](./optimization.md) — Performance optimization runs
- [examples](./examples.md) — Common patterns and recipes

## Lifecycle & Vote Commands

- [init](./init.md) — Initialize a run with topology and vote-strategy settings
- [spawn](./spawn.md) — Register worker agent records into the run
- [status](./status.md) — Show run status, workers, and metrics
- [stop](./stop.md) — Shut down the run
- [consensus](./consensus.md) — Manage proposals and voting
- [memory](./memory.md) — Access the run's shared memory

## Real Tools (11 total)

```
monoswarm_init            Create the run state file (topology, vote strategy, empty worker list)
monoswarm_agent_add       Register worker records into the agent store and run
monoswarm_status          Read run status: lead, workers, task/vote metrics
monoswarm_join            Add an existing agent id to the run's worker list
monoswarm_leave           Remove an agent id from the run's worker list
monoswarm_vote            Propose/vote/check status on threshold-based decisions
monoswarm_notice          Write a message into the run's shared memory
monoswarm_memory          Get/set/delete/list keys in the run's shared memory
monoswarm_audit_list      List signed vote decision records
monoswarm_audit_verify    Verify a vote decision's signatures
monoswarm_shutdown        Clear run workers from the agent store, reset run state
```

## Quick Start

```bash
# Initialize and start a run via CLI
npx monomind swarm init --topology hierarchical --max-agents 8
npx monomind swarm start "Build REST API" --strategy development
npx monomind swarm status
```

For vote-based decisions, use the MCP tools directly — see
[monoswarm](./monoswarm.md) and [consensus](./consensus.md).
