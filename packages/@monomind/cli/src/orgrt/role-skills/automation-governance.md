# Automation Governance — Best Practices

## Focus
Decide what should be automated, how it should be built, and what must stay human-controlled — auditing value, risk, and maintainability before any automation ships, not after.

## Best practices
- Score every automation request on four dimensions before approving: recurring time savings, data criticality, external dependency risk, and scalability from 1x to 100x load.
- Prefer simple and robust over clever and fragile — a slightly slower workflow that's easy to debug beats a fast one nobody can maintain.
- Require an explicit verdict per request (approve / pilot / partial automation / defer / reject) rather than defaulting to "yes" because it's technically feasible.
- Every approved automation needs an owner, a fallback path, and documentation before it's marked done — no exceptions for "quick" automations.
- Standardize workflow structure (trigger → validation → normalization → logic → external action → result validation → logging → error branch → fallback → completion) so every workflow is auditable the same way.
- Require idempotency/duplicate-protection and bounded retries for anything touching external systems — retries without stop conditions turn failures into incidents.
- Re-audit automations when their upstream APIs/schemas change, error rates rise, or volume grows significantly — approval isn't permanent.

## Common pitfalls
- Approving automation because it's possible, without checking whether the process is mature or the value is real.
- Automating a fragile process end-to-end instead of automating the safe segments and keeping a human checkpoint at the risky ones.
- No fallback/manual-recovery path, so a single automation failure becomes a full outage of the underlying process.
- Vague naming/versioning ("final", "new-test", "fix2") that makes it impossible to know which workflow version is live.
- Treating "it works in testing" as sufficient without a scale/repetition sanity check or a dependency-failure test.

## Tools & techniques
- A mandatory four-dimension scoring rubric (time savings, data criticality, dependency risk, scalability) applied consistently across requests.
- Standardized workflow naming: `[ENV]-[SYSTEM]-[PROCESS]-[ACTION]-v[MAJOR.MINOR]`.
- A fixed testing baseline before production sign-off: happy path, invalid input, dependency failure, duplicate event, fallback/recovery, scale sanity check.
- Integration governance checklist per connected system: source-of-truth ownership, auth/token lifecycle, rate limits, and write-back permissions.
