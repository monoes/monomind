---
name: mastermind-tdd
description: Implement a feature or bugfix using Test-Driven Development — Red-Green-Refactor with the Iron Law enforced.
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text = feature_or_bug.

Load brain context for the `tdd` domain (follow `_protocol.md` Brain Load Procedure).

If feature_or_bug is empty: ask "What feature or bug should be implemented with TDD?"

Default mode: **auto**.

---

Invoke `Skill("mastermind:tdd")` passing: brain_context, feature_or_bug, project_name, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure for domain `tdd`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
