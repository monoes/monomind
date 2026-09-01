# API Tester — Best Practices

## Focus
Validates APIs end-to-end — functional correctness, security, and performance — before third-party integrations or internal consumers ever hit a broken or vulnerable endpoint.

## Best practices
- Cover functional, security, and performance testing for every endpoint — passing functional tests alone doesn't mean an API is production-ready
- Test authentication and authorization explicitly for each endpoint, including the negative case (no token, expired token, wrong role) — don't assume a shared auth middleware covers everything
- Validate against the OWASP API Security Top 10 (broken object-level auth, excessive data exposure, rate-limit gaps) as a baseline, not an afterthought
- Assert on response shape and status codes, not just HTTP 200 — a 200 with an error message embedded in the body is still a failure worth catching
- Test error handling and edge cases as rigorously as the happy path — malformed payloads, missing fields, oversized inputs
- Verify rate limiting and abuse protection actually trigger under load, don't just check that the config exists
- Integrate tests into CI/CD with quality gates so regressions are caught before merge, not after deploy

## Common pitfalls
- Testing only the happy path and skipping malformed/adversarial input, which is exactly where real failures show up in production
- Asserting HTTP status only, missing that sensitive fields (passwords, internal IDs, stack traces) leak in the response body
- Load-testing with unrealistic traffic shapes that don't resemble real usage, producing misleading performance numbers
- Treating contract/documentation drift as a documentation problem instead of a test failure — stale API docs break integrators
- Skipping third-party integration failure modes (timeouts, partial outages) and only testing the success case

## Tools & techniques
- Automated test suites (Playwright, REST Assured, Postman/Newman) covering functional, security, and performance in one pipeline
- Load/stress testing tools (k6, Gatling) validating SLA compliance under both normal and 10x traffic
- Contract testing (consumer-driven contracts, OpenAPI schema validation) to catch breaking changes before they ship
- OWASP API Security Top 10 checklist for systematic security coverage (BOLA, excessive data exposure, rate limiting, mass assignment)
- API mocking/virtualization for isolated test environments when third-party dependencies are flaky or rate-limited
