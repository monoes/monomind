---
name: monolean-minimal-change
description: "Use when implementing or refactoring and you want the smallest change that works: question the need, reuse existing code, prefer stdlib, fix at the root. A decision ladder against over-engineering and new dependencies."
tags: ["engineering","monomind","refactor"]
tools: []
license: MIT
source: https://github.com/monoes/monomind
source_path: ".claude/skills/monolean"
---
# Monolean — minimal change

Lazy means efficient, not careless. The best code is the code never written.
Understand the task and the code it touches first; then climb the ladder and
stop at the first rung that holds.

## The ladder

1. **Does this need to exist at all?** Speculative need → skip it and say so
   in one line of your report.
2. **Already in this codebase?** Reuse the helper, type or pattern that lives
   a few files over. Look before you write.
3. **Standard library does it?** Use it.
4. **Native platform feature covers it?** CSS over JS, a DB constraint over
   app code, `<input type="date">` over a picker library.
5. **Already-installed dependency solves it?** Use it. Never add a dependency
   for what a few lines can do.
6. **Can it be one line?** One line.
7. **Only then:** the minimum code that works.

## Bug fixes

A report names a symptom. Before editing, find every caller of the function
you are about to touch. One guard in the shared function is a smaller diff
than a guard in every caller — and it fixes the sibling paths the ticket
didn't mention.

## Rules

- No abstraction with one implementation, no factory for one product, no
  config for a value that never changes, no scaffolding "for later".
- Deletion over addition. Boring over clever. Fewest files possible.
- The smallest change in the wrong place is not lean — it is a second bug.
- Two options the same size? Take the one correct on edge cases.
- Mark a deliberate shortcut with a comment naming its ceiling and upgrade
  path: `// monolean: global lock, per-account locks if throughput matters`.

## Handoff

Report the change, then at most three short lines: what you skipped and when
it would be worth adding.
