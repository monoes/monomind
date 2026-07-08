<!-- Execute an implementation plan task-by-task using fresh subagents with two-stage review per task. Default mode: auto. -->

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = plan_file path (path to the plan `.md` file to execute)

If plan_file is empty: ask "Which plan file should I execute? (provide an absolute path)"

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **auto** (unless `--confirm` flag is present).

---

Invoke `Skill("mastermind-skills:taskdev")` passing: brain_context, plan_file, project_name, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

**MANDATORY — invoke `Skill("mastermind-skills:_repeat")` now.** This is required regardless of how the skill above completed, regardless of whether you think the work is done, regardless of whether you plan to end your response. For `--repeat N`: the count is non-negotiable — all N runs must happen. For `--tillend`: only a verified empty round (confirmed by git diff) stops the loop. Do not end your response without invoking this skill.
