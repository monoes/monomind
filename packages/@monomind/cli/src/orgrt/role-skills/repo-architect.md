# Repo Architect — Best Practices

## Focus
Design and maintain repository structure — directory layout, package boundaries, templates, and cross-repo conventions — so the codebase stays navigable and scalable as it grows.

## Best practices
- Keep a consistent directory convention across packages (e.g. `src/`, `tests/`, `docs/`) so any contributor can navigate a new package by pattern-matching an existing one.
- Define clear package boundaries with explicit dependency direction — avoid circular dependencies between packages.
- Standardize config files (lint, tsconfig, CI workflow) via shared base configs rather than copy-pasted per-package variants that drift.
- Use issue/PR templates so every contribution starts with the right structure instead of ad hoc reports.
- Document architectural decisions (why this package boundary, why this dependency direction) in one discoverable place, updated as decisions change.
- When proposing a restructure, provide a migration path (codemod, phased move) — never just declare the new layout and leave existing code broken.
- Keep root-level clutter minimal; anything not essential at the repo root belongs in a named subdirectory.

## Common pitfalls
- Proposing sweeping restructures without checking what currently depends on the paths being moved.
- Creating "flexible" structure with no real convention, so every package ends up organized differently anyway.
- Introducing a new package without updating the shared templates/workflows, so it silently diverges from day one.
- Letting cross-repo templates drift out of sync because updates only get pushed to one repo.

## Tools & techniques
- Dependency graphs (import graph, package dependency graph) to verify no circular or layer-violating dependencies before approving a structure change.
- Shared/base config files with per-package overrides, not full duplication.
- A documented monorepo package pattern (role, dependencies, what it provides) so new packages fit an established shape.
- `.github/ISSUE_TEMPLATE` and `PULL_REQUEST_TEMPLATE.md` kept in sync across related repos.
