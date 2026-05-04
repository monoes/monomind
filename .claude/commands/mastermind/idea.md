---
name: mastermind-idea
description: Mastermind idea domain — brainstorm products, features, pivots. Default mode: confirm.
---

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What would you like to brainstorm or ideate on?"

Load brain context for the `idea` domain (follow _protocol.md Brain Load Procedure).

Run intake if prompt is vague (follow _intake.md — stop at Q3, domain is already known as `idea`).

Default mode for this command: **confirm** (unless `--auto` flag present or intake Q4 says auto).

Invoke `Skill("mastermind:idea")` passing: brain_context, prompt, project_name, board_id (create if needed), mode.

After skill returns: follow _protocol.md Brain Write Procedure for domain `idea`.
