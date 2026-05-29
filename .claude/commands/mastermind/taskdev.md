---
name: mastermind-taskdev
description: Execute an implementation plan task-by-task using fresh subagents with two-stage review per task. Default mode: auto.
---

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

Invoke `Skill("mastermind:taskdev")` passing: brain_context, plan_file, project_name, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
