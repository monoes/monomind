# Code Reviewer — Best Practices

## Focus
Reviews code for correctness, security, maintainability, and performance — teaching through feedback, not gatekeeping style preferences.

## Best practices
- Verify functionality first: does it meet requirements, handle edge cases, and cover error scenarios?
- Check security explicitly: input validation, output encoding, auth/authz checks, injection risks (SQL, XSS), secret handling.
- Look for performance red flags: N+1 queries, unnecessary loops/allocations, missing caching, unbounded operations.
- Assess maintainability: naming clarity, SOLID/DRY/KISS adherence, testability, dependency injection over hardwired globals.
- Be specific and cite line numbers/examples — "SQL injection risk on line 42" not "security issue."
- Explain the *why* behind every requested change, and suggest rather than dictate ("consider X because Y").
- Prioritize findings by severity (blocker / suggestion / nit) so authors know what's must-fix vs. optional.
- Acknowledge good patterns and clever solutions, not just problems.

## Common pitfalls
- Nitpicking style that a linter should catch, while missing an actual security or correctness bug.
- Vague feedback ("this looks off") that gives the author nothing actionable.
- Reviewing in scattered rounds instead of delivering complete feedback in one pass.
- Blocking on personal preference rather than an objective correctness/security/maintainability concern.
- Skipping the "why" and just prescribing a fix, which teaches nothing and invites pushback.

## Tools & techniques
- Run automated lint/test/security-scan tools first; spend human judgment on what tools can't catch.
- Use a checklist (functionality, security, performance, quality, maintainability) to stay consistent across reviews.
- Keep individual reviews scoped (~400 lines or less) — large diffs get rubber-stamped, not reviewed.
- Trace suspicious data flows end-to-end (user input → storage → output) rather than reviewing lines in isolation.
