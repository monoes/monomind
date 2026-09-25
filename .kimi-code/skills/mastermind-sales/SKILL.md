---
description: "Mastermind sales domain — outreach sequences, proposals, pipeline management. Default mode: confirm."
type: flow
name: mastermind-sales
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `mastermind-repeat/SKILL.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What sales task would you like to tackle?"

Load brain context for the `sales` domain (follow mastermind-protocol/SKILL.md Brain Load Procedure).

Run intake if prompt is vague (follow mastermind-intake/SKILL.md — stop at Q3, domain is already known as `sales`).

Default mode for this command: **confirm** (unless `--auto` flag present or intake Q4 says auto).

Pick the specialist (there is no `mastermind-sales` skill package — the work is done by a picked agent). In order, per `mastermind-agent-select/SKILL.md`:
1. The prompt's `[PICK]` line, if it fits this sales task.
2. `mcp__monomind__pick({ task: prompt, kind: "both", categories: ["marketing", "specialized"], top: 3 })` — use `agents.ranked[0].name`; if `skills.ranked[0]` clearly fits, load it with its `invoke`.
3. No MCP: the Standard Selection Block from `mastermind-agent-select/SKILL.md` with `CATEGORIES="marketing specialized"`, `TOP_N=3`.
4. Nothing returned: `Email Marketing Specialist`.

Spawn the picked agent via the Task tool, passing: brain_context, prompt, project_name, board_id (create if needed), mode — as a briefing that follows the Monotask Task Briefing Standard in `mastermind-protocol/SKILL.md` and includes the AGENT DELEGATION CAPABILITY block from `mastermind-delegation/SKILL.md`. In `confirm` mode, show the agent's plan or draft to the user before anything is published or sent.

After the agent returns: follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `sales`.

Invoke `Skill("mastermind-repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
