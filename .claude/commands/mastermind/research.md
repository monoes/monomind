<!-- Mastermind research domain — market research, competitor analysis, user research, trend scanning. Default mode: auto. -->

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `mastermind-repeat/SKILL.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What would you like researched?"

Load brain context for the `research` domain (follow mastermind-protocol/SKILL.md Brain Load Procedure).

Run intake if prompt is vague (follow mastermind-intake/SKILL.md — stop at Q3, domain is already known as `research`).

Default mode for this command: **auto** (unless `--confirm` flag present or intake Q4 says confirm).

Invoke `Skill("mastermind-research")` passing: brain_context, prompt, project_name, board_id (create if needed), mode.

After skill returns: follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `research`.

**MANDATORY — invoke `Skill("mastermind-repeat")` now.** This is required regardless of how the skill above completed, regardless of whether you think the work is done, regardless of whether you plan to end your response. For `--repeat N`: the count is non-negotiable — all N runs must happen. For `--tillend`: only a verified empty round (confirmed by git diff) stops the loop. Do not end your response without invoking this skill.
