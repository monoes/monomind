# Pre-Merge Security Checklist

Before merging any PR that touches server routes, auth, input handling, SSE/WebSocket,
file system operations, or the MonoFence AI allowlist:

## Input Validation
- [ ] All user-controlled inputs validated via `validateInput()` from `@monomind/security`
- [ ] No raw `req.query` or `req.body` values passed directly to file operations
- [ ] Path traversal check: no `..` in file paths derived from user input

## Data Isolation
- [ ] SSE/WebSocket streams filtered to the requesting project (`?dir=` param)
- [ ] Session data scoped to current org — no cross-org leakage

## MonoFence AI
- [ ] `AllowlistRule.types` entries are explicit (`[]` = full bypass, not "no filtering")
- [ ] New allowlist rules reviewed: does the threat suppression scope match intent?

## Dependency Changes
- [ ] New `@monoes/monograph` version: checked for schema migrations, FK changes, async hangs
- [ ] Run pre-publish integration smoke tests: `npx vitest run packages/@monomind/cli/__tests__/monograph-integration.test.ts`

## API Contract
- [ ] Response field names match `api-types.ts` definitions (no renamed fields)
- [ ] If field names changed: updated `api-types.ts` AND `api-contracts.test.ts`

## Before Merging improve/auto
- [ ] All API contract tests pass: `npx vitest run packages/@monomind/cli/__tests__/api-contracts.test.ts`
- [ ] No `minor: true` in auto-update configs (check `src/update/checker.ts`)
