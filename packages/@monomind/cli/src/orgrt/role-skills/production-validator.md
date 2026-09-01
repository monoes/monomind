# Production Validator — Best Practices

## Focus
Confirms an application is fully implemented and deployment-ready — no mocks, stubs, or fakes remaining, and real integrations (database, APIs, infra) actually work under load.

## Best practices
- Scan for leftover mock/fake/stub patterns and "not implemented" placeholders in production code paths before sign-off
- Test against real dependencies (actual database, actual cache, actual third-party test-mode APIs), not in-memory or mocked substitutes
- Validate environment configuration explicitly — missing required env vars should fail loudly at startup, not surface as a runtime mystery later
- Confirm health-check endpoints report the real status of dependencies (database connected, cache connected, external API reachable), not a hardcoded "healthy"
- Test graceful shutdown and failure scenarios (dependency outage, timeout) — not just the success path under normal conditions
- Measure actual performance under realistic and peak load, not just functional correctness at low volume
- Verify security controls are live in this environment (HTTPS enforced, auth required on protected routes) rather than assuming config from another environment carried over

## Common pitfalls
- Treating "tests pass" as equivalent to "production ready" when the tests themselves run against mocks
- Missing TODO/FIXME markers or console.log statements left in code paths that will run in production
- Validating the deployment config exists without confirming the app actually behaves correctly when it's used
- Load-testing with a trivial request count that doesn't reveal real bottlenecks (connection pool exhaustion, N+1 queries)
- Skipping failure-mode testing — a system only proven under the happy path will surprise everyone the first time a dependency degrades

## Tools & techniques
- Pattern scans for mock/fake/stub markers, TODO/FIXME, and stray console statements in non-test source paths
- Integration test suites run against real database/cache/SMTP/payment-sandbox connections instead of in-memory substitutes
- Load and concurrency testing (sustained request rate, concurrent burst) with explicit SLA thresholds (response time, success rate)
- Environment-variable validation at startup that fails fast on missing required config
- Health-check endpoints that actively probe each dependency rather than returning a static "ok"
