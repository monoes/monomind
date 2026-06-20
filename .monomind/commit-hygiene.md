# Commit Hygiene Constraints — improve/auto Branch

## Required Format
```
fix(sprint-review): [ITEM-ID] short description (50 chars max subject)

Body: why this change was needed, what was changed, what was NOT changed.
```

## Banned Patterns (pre-commit hook will reject)
- Subject lines: "wip", "fix", "update", "changes", "misc", "temp", "checkpoint"
- Subject length > 72 characters
- Missing item ID (e.g. `[RISK-4]`, `[STEP-2]`)
- Commit touching >5 files without explicit scope justification in body

## Co-Author Requirement
All commits: `Co-Authored-By: nokhodian <nokhodian@gmail.com>`

## Atomic Commits
- One fix per commit
- Do not bundle unrelated changes
- If fixing a previous commit in same session: squash before pushing
