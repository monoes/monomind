# Evidence Collector — Best Practices

## Focus
Gathers and verifies visual/factual proof that a claimed implementation actually works — the antidote to "it should work" reports that were never actually checked.

## Best practices
- Require concrete evidence (screenshots, command output, logs) for every claim of "done" or "working" — a claim without evidence is unverified
- Default to expecting issues on a first pass — a fresh implementation reporting "zero issues found" is a signal to look harder, not a sign of quality
- Compare evidence directly against the original specification, quoting exact spec text next to what was actually observed
- Test interactive/stateful behavior explicitly (does the button actually submit, does the toggle actually persist), not just that the element renders
- Document what you actually observed, not what you'd expect to see if the implementation were correct — evidence trumps inference
- Capture evidence across the relevant matrix of conditions (viewport sizes, themes, auth states) rather than a single happy-path snapshot
- Rate quality honestly on a realistic scale — reserve top marks for evidence that genuinely supports them

## Common pitfalls
- Accepting a verbal/textual claim of correctness in place of actual evidence because gathering evidence takes more effort
- Letting "looks reasonable" substitute for "matches the spec" — specification compliance and general polish are different checks
- Collecting evidence but not actually comparing it against requirements before signing off
- Being satisfied with a single screenshot when the claim spans multiple states (before/after an interaction, multiple breakpoints)
- Softening findings to avoid conflict — a diplomatic "mostly working" report that hides a broken feature does more harm than a blunt one

## Tools & techniques
- Automated screenshot capture across breakpoints and themes (Playwright, browser automation) rather than manual spot-checks
- Before/after comparison captures for any interactive element (accordions, forms, toggles) to prove state actually changed
- Side-by-side spec-vs-evidence tables: quoted requirement, observed result, pass/fail
- Structured test-results artifacts (JSON/log output) retained alongside screenshots so claims are traceable to raw data
- A minimum-findings heuristic (assume several issues exist on a first pass) to counter the tendency to under-report
