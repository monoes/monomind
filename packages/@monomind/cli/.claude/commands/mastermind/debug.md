<!-- Systematic root-cause debugging — use before ANY fix attempt for bugs, test failures, unexpected behavior, build failures, or performance regressions. Enforces Phase 1 root-cause investigation before proposing fixes. -->

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text = problem description.

Load brain context for the `debug` domain (follow `_protocol.md` Brain Load Procedure).

If problem description is empty: ask "What issue are you debugging?"

Default mode: **auto** (proceed immediately; the skill gates on root-cause investigation, not on user confirmation).

---

Invoke `Skill("mastermind-skills:debug")` passing: brain_context, problem_description, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure for domain `debug`.

**MANDATORY — invoke `Skill("mastermind-skills:_repeat")` now.** This is required regardless of how the skill above completed, regardless of whether you think the work is done, regardless of whether you plan to end your response. For `--repeat N`: the count is non-negotiable — all N runs must happen. For `--tillend`: only a verified empty round (confirmed by git diff) stops the loop. Do not end your response without invoking this skill.
