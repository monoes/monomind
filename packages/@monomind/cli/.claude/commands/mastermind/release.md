---
name: mastermind-release
description: Mastermind release domain — versioning, changelog, deployment. Default mode: auto.
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What would you like to release or deploy?"

Load brain context for the `release` domain (follow _protocol.md Brain Load Procedure).

Run intake if prompt is vague (follow _intake.md — stop at Q3, domain is already known as `release`).

Default mode for this command: **auto** (unless `--confirm` flag present or intake Q4 says confirm).

Invoke `Skill("mastermind:release")` passing: brain_context, prompt, project_name, board_id (create if needed), mode.

After skill returns: follow _protocol.md Brain Write Procedure for domain `release`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
