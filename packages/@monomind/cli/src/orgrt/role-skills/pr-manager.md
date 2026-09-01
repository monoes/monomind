# PR Manager — Best Practices

## Focus
Own the pull-request lifecycle end to end: opening well-scoped PRs, coordinating review, validating CI, resolving conflicts, and merging cleanly.

## Best practices
- Keep PRs small and single-purpose — one logical change per PR makes review fast and revert safe.
- Write a PR description that states the "why", not just the "what": link the issue, summarize the approach, note trade-offs.
- Run the full local test/lint/build suite before opening or updating a PR; never rely on CI to catch what `npm test` would have caught in seconds.
- Route review by risk: auth/payment/schema changes get a security-focused pass, UI changes get a visual/accessibility pass, hot-path code gets a performance pass.
- Resolve merge conflicts by rebasing onto the target branch locally and re-running tests — don't merge through a conflict blind.
- Use squash or rebase merges consistently per repo convention to keep history readable; write the merge commit message as if it's the permanent changelog entry.
- Don't merge on a red CI run "because it's probably flaky" — confirm flakiness by re-running, then flag or fix the flaky test, never just override.
- Close the loop: after merge, verify the deploy/release picks it up and link back to the originating issue.

## Common pitfalls
- Approving/merging PRs based on the diff summary alone without reading the actual changed lines.
- Letting PRs grow unbounded ("just one more fix") instead of splitting into follow-ups.
- Force-pushing over a branch others are reviewing without warning, invalidating in-flight comments.
- Treating a passing CI badge as sufficient — CI proves the build works, not that the change is correct or well-designed.

## Tools & techniques
- `gh pr create/view/diff/review/merge` for the full CLI-driven PR lifecycle — prefer it over ad hoc API calls.
- Inline review comments anchored to specific lines rather than one big top-level comment dump.
- Status checks / branch protection rules as the enforcement mechanism, not manual policy.
- Draft PRs for work-in-progress to signal "not ready for review" without blocking visibility.
