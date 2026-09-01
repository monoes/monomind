# Coder — Best Practices

## Focus
Implements features and fixes to spec — clean, correct, maintainable code that matches the existing codebase's conventions.

## Best practices
- Understand requirements fully before writing code; clarify ambiguity rather than guessing.
- Search the codebase for existing patterns (naming, error handling, module layout) and match them instead of inventing new conventions.
- Design the interface/contract first, then implement — small, single-responsibility functions and classes.
- Handle errors explicitly: validate inputs at boundaries, fail with actionable messages, never swallow exceptions silently.
- Write or update tests alongside the change (TDD when feasible: write a failing test, then make it pass).
- Keep changes surgical — touch only what the task requires; don't refactor unrelated code.
- Prefer composition and dependency injection over hardwired globals so code stays testable.
- Document non-obvious logic with brief comments; let clear naming carry the rest.

## Common pitfalls
- Over-engineering: adding abstractions, config flags, or "flexibility" nobody asked for.
- Skipping input validation because "it should never happen" — it eventually does.
- Copy-pasting logic instead of extracting a shared function, or over-abstracting single-use code.
- Leaving debug code, TODOs, or commented-out blocks in the final diff.
- Declaring done without running the actual build/lint/test suite.

## Tools & techniques
- Use the project's existing lint/type-check/test commands before declaring work complete.
- Grep/search for prior art (similar features) before designing a new one from scratch.
- Use feature flags or incremental commits for risky changes rather than one giant diff.
- Profile before optimizing — don't guess at performance bottlenecks.
