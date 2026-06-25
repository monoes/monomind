---
name: mastermind-worktree
description: Use when starting feature work that needs isolation from the current workspace or before executing implementation plans — sets up an isolated git worktree
---

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text.

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **auto**.

---

Invoke `Skill("mastermind:worktree")` passing: brain_context, params, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind:_repeat")` now. Required — do not skip.
