---
name: mastermind-plan
description: Write a comprehensive implementation plan from a spec or requirements. Saves to docs/mastermind/plans/. Default mode: confirm.
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = spec description or path to spec file

If spec is empty: ask "What would you like a plan for? (provide a spec, requirements, or feature description)"

Load brain context (follow `_protocol.md` Brain Load Procedure).

Default mode: **confirm** (unless `--auto` flag is present).

---

Invoke `Skill("mastermind:plan")` passing: brain_context, params, project_name, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
