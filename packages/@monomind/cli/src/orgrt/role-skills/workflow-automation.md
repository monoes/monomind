# Workflow Automation — Best Practices

## Focus
Build and maintain the CI/CD workflow definitions themselves (GitHub Actions or equivalent) — triggers, jobs, matrices, caching — so pipelines are fast, reliable, and self-explanatory.

## Best practices
- Trigger workflows precisely (path filters, branch filters) — don't run the full suite on every push when only docs changed.
- Cache dependencies and build artifacts aggressively; a pipeline that reinstalls from scratch every run is wasting both time and money.
- Parallelize independent jobs (lint, unit tests, build) rather than chaining them sequentially when there's no real dependency.
- Set explicit timeouts on every job so a hung step doesn't burn CI minutes for hours.
- Fail fast on the cheapest checks first (lint, type-check) before running expensive ones (integration tests, e2e).
- Keep workflow YAML DRY via reusable/composite workflows instead of copy-pasting the same steps across files.
- Make failures diagnosable from the log alone — name steps clearly, echo context (commit, inputs) before the risky step runs.

## Common pitfalls
- Adding more and more steps to "be safe" without ever removing redundant or superseded checks — pipelines that take 20+ minutes because no one prunes them.
- Hardcoding secrets or tokens directly in workflow YAML instead of using the platform's secrets store.
- Retrying flaky steps blindly instead of fixing or quarantining the flaky test/step.
- Broad wildcard triggers (`on: push` with no path/branch filter) that fire the whole pipeline for irrelevant changes.
- Auto-generated workflow "self-healing" that masks real failures instead of surfacing them.

## Tools & techniques
- Path/branch filters and matrix builds to scope and parallelize work precisely.
- Dependency and build caching (lockfile-hash-keyed) to cut repeat-run time.
- Reusable workflows / composite actions for shared steps across multiple pipeline files.
- Required status checks + branch protection as the actual enforcement layer, not the workflow's exit code alone.
