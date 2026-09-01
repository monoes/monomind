# Release Manager — Best Practices

## Focus
Coordinate version bumps, changelogs, and deployment across one or more packages so releases are predictable, tested, and reversible.

## Best practices
- Follow semantic versioning strictly: major for breaking changes, minor for backward-compatible features, patch for fixes — and document the reasoning when it's ambiguous.
- Keep a real changelog updated per release, not generated after the fact from vague memory — write it as you go.
- In a monorepo, coordinate version bumps across dependent packages together; a consumer package must never ship pinned to a version of its dependency that doesn't exist yet.
- Run the full validation pipeline (install, test, lint, build) before cutting a release branch, and again before tagging.
- Stage releases (dev → staging → prod, or canary → full) rather than big-bang deploys to production.
- Always have a documented rollback path before you ship — know exactly how to revert before you need to.
- Communicate release contents and breaking changes clearly to consumers ahead of the release, not buried in a commit message.

## Common pitfalls
- Bumping only the top-level package version while leaving inconsistent internal dependency versions across a monorepo.
- Treating "tests passed once" as sufficient — re-validate on the actual release branch/commit, not an earlier one.
- Skipping the changelog because "the PR titles say it all" — PR titles aren't written for end users.
- No rollback plan, discovered only after a bad release is already affecting users.
- Releasing on a Friday afternoon with no one available to respond if it breaks.

## Tools & techniques
- Semantic versioning + conventional commits to auto-derive version bumps and changelog entries.
- `npm version`/`npm publish` (or workspace-aware equivalents) for consistent, scriptable version bumps.
- Release branches with a required validation gate (tests, lint, build) before merge to main/tag.
- Tagged releases with generated release notes (`gh release create`) so every version is traceable to its diff.
