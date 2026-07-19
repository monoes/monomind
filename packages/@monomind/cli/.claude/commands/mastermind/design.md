<!-- Collaborative design session — explore intent, clarify requirements, propose approaches, and produce an approved spec before any implementation begins. -->

**First — extract repeat flags:** Follow REPEAT PREAMBLE from `mastermind-repeat/SKILL.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text.

Load brain context (follow `mastermind-protocol/SKILL.md` Brain Load Procedure).

Default mode: **confirm**.

---

Invoke `Skill("mastermind-design")` passing: brain_context, params, mode.

After skill returns: follow `mastermind-protocol/SKILL.md` Brain Write Procedure.

Invoke `Skill("mastermind-repeat")` now. Required — do not skip.
