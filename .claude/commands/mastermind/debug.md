---
name: mastermind-debug
description: Systematic root-cause debugging — use before ANY fix attempt for bugs, test failures, unexpected behavior, build failures, or performance regressions. Enforces Phase 1 root-cause investigation before proposing fixes.
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text = problem description.

Load brain context for the `debug` domain (follow `_protocol.md` Brain Load Procedure).

If problem description is empty: ask "What issue are you debugging?"

Default mode: **confirm** (present diagnostic plan before running any fixes).

---

Invoke `Skill("mastermind:debug")` passing: brain_context, problem_description, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure for domain `debug`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
