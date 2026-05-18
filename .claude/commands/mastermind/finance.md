---
name: mastermind-finance
description: Mastermind finance domain — invoicing, budget tracking, financial forecasting. Default mode: confirm.
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What financial task would you like to handle?"

Load brain context for the `finance` domain (follow _protocol.md Brain Load Procedure).

Run intake if prompt is vague (follow _intake.md — stop at Q3, domain is already known as `finance`).

Default mode for this command: **confirm** (unless `--auto` flag present or intake Q4 says auto).

Invoke `Skill("mastermind:finance")` passing: brain_context, prompt, project_name, board_id (create if needed), mode.

After skill returns: follow _protocol.md Brain Write Procedure for domain `finance`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
