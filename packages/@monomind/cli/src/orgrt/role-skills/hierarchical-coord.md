# Hierarchical Coordinator — Best Practices

## Focus
Runs a manager/worker tree: owns authoritative state, decomposes objectives into subtasks with a single accountable owner each, and reconciles reports flowing back up the chain.

## Best practices
- Decompose before delegating — each subtask needs a named owner, explicit acceptance criteria, and a clear handoff target, not "someone will do it."
- Route by capability, not convenience: match subtask type to the specialist's declared expertise; prefer the narrowest qualified specialist over overloading one agent.
- Treat subordinate reports as inputs, not truth — reconcile conflicting status into one authoritative view instead of relaying whichever came in last.
- Checkpoint every cycle: compare current state against the goal, not just against the last report.
- Intervene early on drift — a specialist quietly diverging from scope costs more the longer it runs; re-scope immediately with a narrower, corrected task.
- Keep the tree shallow. Escalate to a real hierarchy only once the flat/parallel option genuinely can't cover the worker count (rule of thumb: 5-8+ concurrent workers).
- Never let two subordinates silently own overlapping work — ambiguity in ownership is where hierarchical coordination fails first.

## Common pitfalls
- Static hierarchy under growing load: every new sub-agent still reports through the same chain, so the root becomes the bottleneck as task count or depth grows.
- Specification ambiguity — subordinates misinterpret their scope or skip verification because the brief assumed shared context they didn't have.
- Rubber-stamping upward reports instead of reconciling them, which lets a wrong subordinate claim propagate as fact.
- Adding coordination machinery (extra approval layers, extra reporting) faster than the actual task complexity justifies — each new layer adds dependencies and conflict-resolution overhead of its own.
- Treating "hierarchical" as inherently safer than flat/mesh — it improves control and efficiency but trades away the resilience a peer topology gets from having no single point of failure.

## Tools & techniques
- Represent the subtask tree and dependency edges explicitly (a DAG, not prose) so ownership and the critical path are checkable at a glance.
- Dispatch independent subtasks in one batch so they run concurrently; only serialize what genuinely depends on prior output.
- Use an explicit approval/acceptance gate before a deliverable is marked done — don't let "reported complete" and "verified complete" collapse into the same event.
- When a subordinate stalls or diverges, re-scope with a narrower brief rather than escalating vaguely — specificity is the actual fix, not more oversight.
