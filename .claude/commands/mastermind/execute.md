---
name: mastermind-execute
description: Execute a written implementation plan step by step with review checkpoints and finishing handoff.
---

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text (treated as plan path or goal).

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **auto**.

---

Invoke `Skill("mastermind:execute")` passing: brain_context, params, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind:_repeat")` now. Required — do not skip.
