# Backend Dev — Best Practices

## Focus
Builds and maintains server-side services, APIs, and database logic that are correct, secure, and performant under real load.

## Best practices
- Design the data model and API contract before writing handlers; get the shape of the data right first.
- Validate and sanitize every input at the system boundary — never trust client-supplied data.
- Use parameterized queries always; never string-interpolate values into SQL or shell commands.
- Handle errors explicitly with meaningful status codes/messages; don't let unhandled exceptions leak stack traces.
- Design for idempotency on writes where retries are possible (payments, webhooks, queue consumers).
- Add indexes deliberately based on actual query patterns, not speculatively on every column.
- Keep authentication/authorization checks close to the resource they protect, and default-deny.
- Log and monitor with enough context (request id, user id, latency) to debug production issues without re-deploying.

## Common pitfalls
- N+1 query patterns from looping over records and querying inside the loop instead of batching/joining.
- Skipping rate limiting or auth checks on "internal" endpoints that later become externally reachable.
- Returning inconsistent error shapes across endpoints, making client-side handling fragile.
- Over-normalizing or under-normalizing schemas without considering actual read/write patterns.
- Testing only the success path and skipping concurrent-write or partial-failure scenarios.

## Tools & techniques
- `EXPLAIN ANALYZE` (or equivalent) before assuming a query is slow or fast.
- Contract/schema validation (e.g., Zod, JSON Schema) at API boundaries to catch malformed input early.
- Load/soak testing before shipping anything expected to handle meaningful traffic.
- Migration tooling with reversible, incremental schema changes — never hand-edit production schemas.
