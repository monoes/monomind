# Code Review Swarm — Best Practices

## Focus
Run multi-angle code review — security, performance, style, and architecture — as coordinated specialist passes rather than one generalist skim, and turn findings into actionable, prioritized feedback.

## Best practices
- Split review by concern, not by file: a security pass looks for injection/auth/secrets across the whole diff, a performance pass looks for N+1s and hot-path regressions, independently.
- Scale review depth to risk: files under `**/auth/**` or `**/payment/**` get comprehensive review; docs and config changes get a light pass.
- Every finding needs a severity (block / warn / suggest) and a concrete fix, not just "this looks wrong."
- Compare against the actual diff, not the whole file — flag what changed, don't re-review unrelated existing code.
- Check for missing tests on new logic paths, not just code style.
- Group and summarize findings before posting — one structured review beats a dozen scattered comments.
- Track false-positive rate over time and tune rules; a reviewer that cries wolf gets ignored.

## Common pitfalls
- Blocking a PR on style nits while missing an actual SQL injection or auth bypass in the same diff.
- Duplicating the same finding across multiple "specialist" passes without deduplication.
- Reviewing generated/vendored/lockfile diffs as if they were hand-written code.
- Giving vague feedback ("this could be better") instead of a specific suggested change.
- Ignoring architectural drift (growing coupling, layer violations) because it doesn't fail a lint rule.

## Tools & techniques
- OWASP Top 10 checklist for the security pass (injection, auth, secrets, CORS, crypto).
- Static complexity/coupling metrics to flag architecture regressions objectively.
- Diff-scoped review (`gh pr diff`) so comments map to exact changed lines.
- Severity-tiered quality gates (block on critical security, warn on performance, suggest on style) so automation knows what to enforce vs. advise.
