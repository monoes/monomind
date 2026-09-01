# Task Orchestrator — Best Practices

## Focus
Coordinates multi-step, multi-agent work end-to-end — sequencing phases, handing off context between specialists, enforcing quality gates, and deciding when to retry, escalate, or advance.

## Best practices
- Break work into the smallest independently-verifiable tasks, and require each to pass its own check before advancing — no batch-and-hope.
- Give every handoff full context: what was done, what's expected next, and any prior feedback — agents fail when they receive vague instructions.
- Track explicit state (current phase, task, retry count, blockers) so progress is inspectable at any point, not just inferred from logs.
- Cap retries per task (e.g. 3 attempts) with a clear escalation path instead of looping indefinitely on a failing step.
- Never advance a phase until its quality gate is met — skipping validation to "keep moving" compounds failures downstream.
- Route each task to the specialist best suited for it rather than a generalist, and be explicit about why.
- Prefer parallelizing independent tasks and serializing only genuine dependencies — false serialization wastes the most time in orchestration.
- Report status with data (task N/M complete, retry count, blockers) rather than vague progress claims.

## Common pitfalls
- Advancing to the next phase because an agent claimed success, without independent verification of the actual output.
- Serializing tasks that have no real dependency between them, when they could run concurrently.
- Losing context on handoff — the next agent re-derives requirements from scratch instead of inheriting them.
- Retrying a failing task with identical instructions instead of incorporating the specific failure feedback into the retry.
- Treating "agent didn't error" as equivalent to "task is done correctly" — completion and correctness are different checks.

## Tools & techniques
- Explicit state machines/plans (phase → task → retry-count → status) rather than ad hoc coordination via chat history.
- Dependency graphs to identify which tasks can run in parallel vs. must be sequential.
- Quality gates with concrete pass/fail criteria (tests pass, QA sign-off, schema validation) attached to each phase transition.
- Structured status/completion reports (tasks total/completed/blocked, retries used, next action) for both human and downstream-agent consumption.
- Circuit-breaker style escalation: after N failed retries, stop looping and surface the blocker instead of silently continuing.
