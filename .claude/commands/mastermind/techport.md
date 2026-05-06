---
name: mastermind-techport
description: Tech Port — deep-analyzes a foreign project folder and recommends porting valuable features, patterns, or infrastructure into the current monomind base project.
---

Parse `$ARGUMENTS` for:
- First path-like token (starts with `/`, `./`, `../`, or `~`) → source_path
- `--auto` flag → mode = auto (port immediately after analysis)
- `--confirm` flag → mode = confirm (present plan, wait for approval before porting)
- `--partial` flag → suggest partial/selective ports only (no full port option)
- Remaining text after flags = focus_hint (optional: what kind of value to look for)

If source_path is empty: ask "What is the path to the project you want to analyze?"

Default mode: **confirm** (show analysis + port plan, wait before executing anything).

Invoke `Skill("mastermind:techport")` passing: source_path, focus_hint, mode.
