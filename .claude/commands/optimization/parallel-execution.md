---
name: optimization:parallel-execution
description: Execute independent subtasks in parallel using Claude Code's Task tool — spawn all agents in one message, use swarm coordination, and monitor with swarm_status
---

# Parallel Task Execution

Execute independent subtasks in parallel for maximum throughput. Parallel execution is handled by Claude Code's Task tool — not a CLI command.

## The Pattern: Spawn All Agents in One Message

```javascript
// Initialize swarm coordination
// npx monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized

// Then spawn ALL agents in ONE message with run_in_background: true
Task({ prompt: "Design API structure and document decisions", subagent_type: "system-architect", run_in_background: true });
Task({ prompt: "Implement auth endpoints following the architecture", subagent_type: "coder", run_in_background: true });
Task({ prompt: "Implement CRUD endpoints in parallel with auth", subagent_type: "coder", run_in_background: true });
Task({ prompt: "Write tests as features complete", subagent_type: "tester", run_in_background: true });
Task({ prompt: "Review code quality and security", subagent_type: "reviewer", run_in_background: true });
```

After spawning, **stop and wait** — do not poll or check status. Agents report back when done.

## Coordination via MCP

```javascript
// Orchestrate a parallel task plan
mcp__monomind__coordination_orchestrate({
  task: "Build REST API with auth, CRUD, and tests",
  strategy: "parallel",
  maxAgents: 8
})
```

## Task Decomposition Principles

1. **Identify independent components** — what has no dependency on others?
2. **Assign by specialization** — coder for implementation, tester for tests, architect for design
3. **Synchronize at dependency points** — one agent waits for another's output before proceeding
4. **Keep tasks focused** — one clear objective per agent, not a list of things

## Example Breakdown for a Feature

| Agent | Task | Depends On |
|---|---|---|
| Architect | Design data model + API contract | — |
| Coder A | Implement auth module | Architect |
| Coder B | Implement CRUD module | Architect |
| Tester | Write integration tests | Coder A + B |
| Reviewer | Code review + security check | Coder A + B |

## Performance Impact

With 5 parallel agents on a typical feature:
- Sequential: ~30 minutes
- Parallel: ~10–12 minutes (2.5–3x faster)

The bottleneck shifts to synchronization points, not raw execution time.

## Monitor Active Execution

```bash
# Check current swarm and agent status
npx monomind status --watch

# Or via MCP
mcp__monomind__swarm_status({ includeMetrics: true })
```

## See Also

- `swarm init` — configure topology before spawning
- `status` — monitor parallel execution progress
- `hooks pre-task` — get agent recommendations before spawning
