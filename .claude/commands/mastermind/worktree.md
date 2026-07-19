<!-- Use when starting feature work that needs isolation from the current workspace or before executing implementation plans — sets up an isolated git worktree -->

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `mastermind-repeat/SKILL.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text.

Load brain context (follow `mastermind-protocol/SKILL.md` Brain Load Procedure).

Default mode: **auto**.

---

Invoke `Skill("mastermind-worktree")` passing: brain_context, params, mode.

After skill returns: follow `mastermind-protocol/SKILL.md` Brain Write Procedure.

Invoke `Skill("mastermind-repeat")` now. Required — do not skip.
