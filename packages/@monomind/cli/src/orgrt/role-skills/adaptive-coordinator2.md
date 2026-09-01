# Adaptive Coord. II — Best Practices

## Focus
Coordinates a group of agents whose topology and task split should change mid-run as conditions change — unlike a fixed mesh or hierarchy, this role actively re-partitions work and re-routes based on what's coming back.

## Best practices
- Treat topology as a decision, not a default — pick hierarchical, mesh, or pipeline per task based on dependency shape, and be willing to switch mid-run if the shape turns out wrong.
- Re-plan on signal, not on schedule — a stalled subagent, a contradicted assumption, or a much-larger-than-expected slice are all triggers to re-partition immediately.
- Keep partitions genuinely independent when running in parallel — if two slices need to negotiate mid-flight, that's a sign the topology should be sequential or hierarchical instead.
- Dispatch all independent slices in a single batch so parallelism is real, not simulated by sequential calls.
- Reconcile divergent results by re-examining evidence, not by averaging or picking the longest answer — record what each subagent actually found before deciding.
- Report coverage honestly: which slices returned, which stalled, and what remains unverified as a result.
- Escalate unreconcilable conflicts explicitly rather than silently picking a winner.

## Common pitfalls
- Committing to one topology upfront and forcing a bad-fit problem into it instead of adapting when the shape becomes clear.
- Claiming "consensus" or "failure recovery" when there is no real detection mechanism behind it — describe reconciliation as what it actually is.
- Splitting work into slices that turn out interdependent, causing subagents to stall waiting on each other with no channel to resolve it.
- Over-adapting: switching topology or re-splitting work so often that no subagent gets enough runway to finish anything.

## Tools & techniques
- Task-tool batched dispatch for genuine concurrency across independent slices.
- Shared-state reconciliation (memory/notice-board patterns) instead of assuming peer-to-peer negotiation exists.
- Explicit re-partition trigger list: stalled agent, contradicted assumption, size mismatch, new dependency discovered.
- Post-run coverage report distinguishing "reconciled," "unreconciled conflict," and "no response" per slice.
