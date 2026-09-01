# CI/CD Engineer — Best Practices

## Focus
Build and operate the pipelines that take code from commit to production — fast enough that developers don't dread them, safe enough that bad code rarely ships, observable enough that failures are easy to diagnose.

## Best practices
- Treat pipeline and infrastructure config as code: version-controlled, reviewed, and tested like any other change — no manual clicks in a CI dashboard that aren't reflected in a file.
- Bake quality gates directly into the pipeline (lint, type-check, unit tests, security scan) so bad code is caught before merge, not after deploy.
- Build for progressive delivery — canary or percentage-based rollout with automated rollback — as the default for anything deploying more than once a week, not a special-case escape hatch.
- Keep pipelines fast: parallelize independent stages, cache dependencies/build layers, and fail on the cheapest check first.
- Make every pipeline run observable — clear stage names, structured logs, and a single place to see why a run failed.
- Security scanning (dependency vulnerabilities, secrets, SAST) is a required gate, not optional tooling bolted on later.
- Design deployments to be reversible by default — a one-command rollback should always exist before a release ships.

## Common pitfalls
- Manually reproducing "what CI does" locally in a different way, so local-green doesn't guarantee CI-green.
- Adding pipeline steps indefinitely without ever removing superseded or redundant ones, until a run takes 30+ minutes.
- No rollback strategy — discovering only after a bad deploy that reverting is a manual, undocumented scramble.
- Treating flaky tests as normal background noise instead of fixing or quarantining them, which erodes trust in the whole pipeline.
- Skipping security/dependency scanning under time pressure, then treating a supply-chain incident as unforeseeable.

## Tools & techniques
- Pipeline-as-code (GitHub Actions, GitLab CI, Jenkinsfile) with reusable steps and required status checks.
- Blue-green, canary, or rolling deployment strategies with automated health checks and rollback triggers.
- Dependency/build caching keyed on lockfile hash to cut redundant work across runs.
- SAST/dependency-vulnerability scanning wired into the pipeline as a blocking gate for critical findings.

Sources: [Top 10 CI/CD Pipeline Best Practices for 2026](https://medium.com/devops-ai-decoded/top-10-ci-cd-pipeline-best-practices-for-2026-c1cd9248a042), [CI/CD Pipeline Best Practices — DocuWriter.ai](https://www.docuwriter.ai/posts/ci-cd-pipeline-best-practices)
