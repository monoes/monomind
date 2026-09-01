# Workflow Architect — Best Practices

## Focus
Maps complete workflow trees for systems, user journeys, and agent interactions — happy paths, every branch, failure modes, recovery paths, and handoff contracts — before implementation starts.

## Best practices
- Discover workflows before designing them: read every route, worker, migration, and infra config — most workflows are implied by code, never announced.
- Design branches, not just the happy path: every step needs its validation failures, timeouts, transient/permanent failures, partial failures, and concurrent conflicts covered.
- Define explicit handoff contracts at every system boundary — payload shape, success/failure response, timeout value, and the recovery action on failure.
- Specify observable state at every step: what the customer sees, what the operator sees, what's in the database, what's in the logs.
- Build a cleanup inventory for every resource a workflow creates — every created resource needs a corresponding destroy path on failure.
- Verify specs against actual code, not stated intent — code and description diverge constantly; find and surface the divergence.
- Track every unverifiable assumption explicitly in the spec — an untracked assumption is a future bug.

## Common pitfalls
- Specifying only the success case and leaving failure/timeout/partial-failure branches implicit or unwritten.
- Making implementation decisions instead of specifying required behavior — that's the implementer's job, not the spec's.
- Leaving a handoff's failure response or timeout undefined, so downstream code guesses.
- Letting the spec drift silently from the code after either one changes.

## Tools & techniques
- Structured workflow-tree spec format: Trigger -> Steps (with timeout/success/failure) -> Cleanup Inventory -> State Transitions -> Test Cases.
- Discovery pass over routes, workers, migrations, and IaC before writing any spec.
- Derive one test case per branch in the tree — an unspecced branch is an untested branch.
- Cross-check every spec with a reality pass against the actual implementation before marking it approved.
