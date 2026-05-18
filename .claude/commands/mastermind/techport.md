---
name: mastermind-techport
description: Tech Port — deep-analyzes a foreign project folder and recommends porting valuable features, patterns, or infrastructure into the current monomind base project.
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check below.

Parse `$ARGUMENTS` for:
- First path-like token (starts with `/`, `./`, `../`, or `~`) → source_path
- `--auto` flag → mode = auto (port immediately after analysis)
- `--confirm` flag → mode = confirm (present plan, wait for approval before porting)
- `--partial` flag → suggest partial/selective ports only (no full port option)
- Remaining text after flags = focus_hint (optional: what kind of value to look for)

If source_path is empty: ask "What is the path to the project you want to analyze?"

Default mode: **confirm** (show analysis + port plan, wait before executing anything).

> **Note for `--tillend` / `--repeat` loops:** This command defaults to `--confirm`, which presents a plan but doesn't execute it. In an unattended loop, this means each run will find items (findings = yes) but take no action (actions = no), so `TILLEND_EMPTY` never becomes true and the loop runs until the safety cap. Always add `--auto` when using this command in a loop:
> ```
> /mastermind:techport --tillend --auto /path/to/project
> ```

Invoke `Skill("mastermind:techport")` passing: source_path, focus_hint, mode.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
