---
name: mastermind-receive-review
description: Use when receiving code review feedback to evaluate and implement it with technical rigor — verifies before implementing, clarifies unclear items first, applies reasoned pushback when warranted
---

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text.

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **confirm**.

---

Invoke `Skill("mastermind:receive-review")` passing: brain_context, params, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind:_repeat")` now. Required — do not skip.
