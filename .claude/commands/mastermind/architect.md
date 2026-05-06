---
name: mastermind-architect
description: Mastermind architect domain — architecture review, file structure deduplication, coupling analysis, design pattern audit, DDD mapping, and system design. Default mode: confirm.
---

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm (default)
- `--project <name>` → project_name = <name>
- `--scope <scope>` → scope = review | design | deduplicate | migrate | all (default: infer from prompt)
- `--stack <stack>` → stack hint (e.g. typescript, python, react, go) — auto-detected if omitted
- Remaining text = prompt

If prompt is empty: ask "What would you like the architect to do? (e.g. 'review the codebase structure', 'deduplicate files', 'design the API layer', 'map bounded contexts')"

Load brain context for the `architect` domain (follow _protocol.md Brain Load Procedure).

Run intake if prompt is vague (follow _intake.md — stop at Q3, domain is already known as `architect`).

Default mode for this command: **confirm** (show architecture plan before executing, unless `--auto` flag present).

Invoke `Skill("mastermind:architect")` passing: brain_context, prompt, project_name, board_id (create board named `architect` inside the `<project_name>` monotask space if not already present), mode, scope, stack.

After skill returns: follow _protocol.md Brain Write Procedure for domain `architect`.
