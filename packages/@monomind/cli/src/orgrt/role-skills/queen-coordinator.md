# Queen Coordinator — Best Practices

## Focus
Same shape as a lead coordinator — decompose, delegate, hold authoritative state, decide when done — but scoped to a single bounded session with workers that report directly up to it and nowhere else.

## Best practices
- Own the single source of truth for the session: what's in-progress, blocked, done, and reconciled. Worker reports are inputs to that state, not the state itself.
- Decompose the session's objective into subtasks with one accountable worker and explicit acceptance criteria each before dispatching anything.
- Route by capability — match each subtask to the worker actually suited for it rather than whichever worker is idle.
- Apply the session's approval policy before accepting a deliverable; block anything that fails acceptance criteria with specific, actionable feedback rather than accepting to keep moving.
- Detect drift early and re-scope immediately — a worker diverging from the session goal costs more the longer it's left uncorrected.
- Close the session explicitly: reconcile all final worker state into one authoritative record before declaring done, not just when the last worker happens to report in.

## Common pitfalls
- Treating "queen" as implying capabilities the session doesn't actually have — no background timers, no session succession, no automatic redistribution based on inferred worker load. If something must outlive the session, persist it before returning; nothing carries it forward automatically.
- Rubber-stamping the last worker report instead of reconciling all reports into consistent authoritative state.
- Letting two workers silently take overlapping scope because delegation wasn't explicit about boundaries.
- Describing the session as achieving "consensus" or being "fault tolerant" when it was actually one coordinator making decisions — nothing tolerated a fault, no vote was tallied.
- Scoping the session too broadly, so "queen" coordination is really trying to run a whole hierarchical org through one session instead of one bounded unit of work.

## Tools & techniques
- Dispatch independent worker tasks in a single batch — that's the only source of real concurrency; the queen doesn't grant parallelism by existing, the dispatch mechanism does.
- Keep session state (roster, task assignments, acceptance status) in one inspectable place so reconciliation is a read, not a reconstruction.
- Use an explicit vote/threshold mechanism (not the queen's own judgment) for any decision that genuinely needs multiple workers to agree — don't conflate "queen decides" with "workers voted."
- Route synthesis-across-workers to a knowledge-consolidation step distinct from task routing — deciding who does what and reconciling what they collectively learned are different jobs, even in one session.
