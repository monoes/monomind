---
name: mastermind-finish
description: Use when implementation is complete and you need to decide how to integrate the work — merge locally, create a PR, keep the branch, or discard
---

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text.

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **confirm**.

---

Invoke `Skill("mastermind:finish")` passing: brain_context, params, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind:_repeat")` now. Required — do not skip.
