<!-- Write a comprehensive implementation plan from a spec or requirements. Saves to docs/mastermind/plans/. Default mode: confirm. -->

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `mastermind-repeat/SKILL.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = spec description or path to spec file

If spec is empty: ask "What would you like a plan for? (provide a spec, requirements, or feature description)"

Load brain context (follow `mastermind-protocol/SKILL.md` Brain Load Procedure).

Default mode: **confirm** (unless `--auto` flag is present).

---

Invoke `Skill("mastermind-plan")` passing: brain_context, params, project_name, mode.

After skill returns: follow `mastermind-protocol/SKILL.md` Brain Write Procedure.

**MANDATORY — invoke `Skill("mastermind-repeat")` now.** This is required regardless of how the skill above completed, regardless of whether you think the work is done, regardless of whether you plan to end your response. For `--repeat N`: the count is non-negotiable — all N runs must happen. For `--tillend`: only a verified empty round (confirmed by git diff) stops the loop. Do not end your response without invoking this skill.
