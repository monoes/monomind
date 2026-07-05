<!-- Use when creating, editing, or verifying mastermind skills — guides the full TDD-for-docs cycle from baseline test through deployment -->

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text.

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **auto**.

---

Invoke `Skill("mastermind-skills:skill-builder")` passing: brain_context, params, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind-skills:_repeat")` now. Required — do not skip.
