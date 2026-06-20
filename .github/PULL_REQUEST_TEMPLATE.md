## Summary

<!-- 1-3 bullet points describing what this PR does -->

## Test plan

- [ ] `npm test` passes in `packages/@monomind/cli` — all API contract tests pass
- [ ] If changing server response shapes (field names, added/removed fields): updated contract test expectations in `__tests__/api-contracts.test.ts`
- [ ] If changing monograph integration (`monograph_build`, `monograph_query`, staleness): updated `__tests__/monograph-integration.test.ts`
- [ ] If adding/modifying SSE events: verified `StepEvent.projectDir` is present for server-side filtering
- [ ] No session field names changed from camelCase to snake_case (or vice versa)

## Checklist

- [ ] Completed [Security Checklist](.github/SECURITY_CHECKLIST.md) for any security-relevant changes
- [ ] Branch is up to date with `main`
- [ ] `npm run build` succeeds without errors
- [ ] No `.env` files or secrets committed
- [ ] Commit messages follow conventional commits (`feat:`, `fix:`, `refactor:`, etc.)

🤖 Generated with [monomind](https://github.com/monoes/monomind)
