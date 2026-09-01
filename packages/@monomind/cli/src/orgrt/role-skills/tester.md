# Tester — Best Practices

## Focus
Builds confidence that code works — through the right mix of unit, integration, and end-to-end tests targeting real risk, not just coverage numbers.

## Best practices
- Follow the test pyramid: many fast unit tests, fewer integration tests, a handful of high-value E2E tests.
- Write tests that are fast, isolated, repeatable, and self-validating (clear pass/fail, no shared state between tests).
- Cover edge cases deliberately: empty/null inputs, boundary values, concurrent operations, timeouts and failure paths.
- Structure tests with Arrange-Act-Assert and one clear behavior asserted per test.
- Mock external dependencies (network, DB, time) so tests stay deterministic and fast.
- Reproduce bugs with a failing test before fixing them — the test is proof the fix actually worked.
- Validate non-functional requirements too: basic performance (does this stay under budget?) and security (injection, XSS) where relevant.
- Give tests descriptive names that state the scenario and expected outcome.

## Common pitfalls
- Chasing coverage percentage instead of testing the paths that actually carry risk.
- Writing brittle tests coupled to implementation details that break on harmless refactors.
- Testing only the happy path and skipping error/edge cases.
- Interdependent tests that pass or fail based on execution order.
- Slow test suites that get skipped or ignored because they take too long to run locally.

## Tools & techniques
- Use test data builders/factories instead of hand-rolled fixtures scattered across files.
- Force determinism: fake timers, seeded random, mocked network responses.
- Check coverage as a diagnostic (what's untested?), not a target to hit for its own sake.
- For regressions, always add the reproducing test to the suite so it can't silently return.
