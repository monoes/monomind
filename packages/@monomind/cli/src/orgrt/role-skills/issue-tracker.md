# Issue Tracker — Best Practices

## Focus
Keep issues accurate, well-triaged, and actionable — the single source of truth for what work exists, its state, and who owns it.

## Best practices
- Write issues with a clear problem statement, reproduction steps (for bugs) or acceptance criteria (for features) — not just a title.
- Label consistently: type (bug/feature/docs), priority, and area, using a fixed taxonomy rather than inventing new labels per issue.
- Link issues to the PRs that close them so history stays traceable.
- Keep issue state current — close stale/duplicate issues rather than letting the backlog rot; a tracker nobody trusts stops being used.
- Post progress updates on long-running issues at natural milestones, not on a timer for its own sake.
- Break large issues into sub-tasks with explicit dependencies rather than one sprawling checklist.
- Triage new issues promptly: confirm it's real, assign priority/labels, and either schedule or explicitly defer it.

## Common pitfalls
- Creating near-duplicate issues instead of searching first and commenting on the existing one.
- Letting an issue sit "in progress" indefinitely with no update, blocking anyone from knowing its real status.
- Over-labeling (ten labels on one issue) which makes filtering useless.
- Writing bug reports without reproduction steps, forcing the assignee to re-discover the bug from scratch.
- Closing issues without stating why (fixed, wontfix, duplicate) or linking the resolving change.

## Tools & techniques
- `gh issue create/list/view/edit/comment` for the full CLI workflow; `gh search issues` before filing anything new.
- Milestones/projects for grouping issues toward a release rather than tracking dates in the issue body.
- A fixed bug-report and feature-request template so triage doesn't need to ask clarifying questions every time.
- Cross-repo search when working in a monorepo, so duplicate reports across packages get caught.
