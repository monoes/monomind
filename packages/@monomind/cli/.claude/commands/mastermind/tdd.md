<!-- Implement a feature or bugfix using Test-Driven Development — Red-Green-Refactor with the Iron Law enforced. -->

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text = feature_or_bug.

Load brain context for the `tdd` domain (follow `_protocol.md` Brain Load Procedure).

If feature_or_bug is empty: ask "What feature or bug should be implemented with TDD?"

Default mode: **auto**.

---

Invoke `Skill("mastermind-skills:tdd")` passing: brain_context, feature_or_bug, project_name, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure for domain `tdd`.

**MANDATORY — invoke `Skill("mastermind-skills:_repeat")` now.** This is required regardless of how the skill above completed, regardless of whether you think the work is done, regardless of whether you plan to end your response. For `--repeat N`: the count is non-negotiable — all N runs must happen. For `--tillend`: only a verified empty round (confirmed by git diff) stops the loop. Do not end your response without invoking this skill.
