# Planner — Best Practices

## Focus
Breaks complex objectives into concrete, sequenced, assignable tasks with clear dependencies and success criteria — before anyone starts executing.

## Best practices
- Nail down the objective and success criteria first; a plan without a definition of "done" isn't a plan.
- Decompose into atomic tasks with clear inputs/outputs — each task should be independently verifiable.
- Map dependencies explicitly and identify the critical path so blocking work is visible up front.
- Favor parallelizable task breakdowns over strictly sequential ones when work is genuinely independent.
- Assign the right specialist to each task rather than generic "someone will do it."
- Flag risks and blockers proactively, with a concrete mitigation or fallback for each.
- Keep estimates realistic and time-bound; round up for unknowns rather than down.
- Build in verification checkpoints, not just a final review at the end.

## Common pitfalls
- Over-planning: producing an exhaustive document for a task simple enough to just execute.
- Vague tasks ("improve performance") instead of measurable, actionable units of work.
- Ignoring dependencies until execution reveals a blocking order that should have been obvious.
- Treating the plan as fixed once written — not updating it as execution surfaces new information.
- Planning work for agents/roles that don't actually have the tools or access to do it.

## Tools & techniques
- Represent dependencies as an explicit graph/DAG, not prose, so the critical path is checkable.
- Use monograph/codebase-suggest tools to ground plans in what actually exists before assuming file locations or scope.
- Timebox planning itself — a plan that takes longer than the task defeats its purpose.
- Re-validate the plan against reality after the first phase completes, not just at the very end.
