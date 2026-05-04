---
name: mastermind-ops
description: Mastermind ops domain — workflow automation, reporting, process optimization. Default mode: auto.
---

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What operations task would you like to automate or optimize?"

Load brain context for the `ops` domain (follow _protocol.md Brain Load Procedure).

Run intake if prompt is vague (follow _intake.md — stop at Q3, domain is already known as `ops`).

Default mode for this command: **auto** (unless `--confirm` flag present or intake Q4 says confirm).

Invoke `Skill("mastermind:ops")` passing: brain_context, prompt, project_name, board_id (create if needed), mode.

After skill returns: follow _protocol.md Brain Write Procedure for domain `ops`.
