---
description: "Mastermind ops domain — workflow automation, reporting, process optimization. Default mode: auto."
type: flow
name: mastermind-ops
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `mastermind-repeat/SKILL.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-prompt check and intake below.

Parse `$ARGUMENTS` for:
- `--auto` flag → mode = auto
- `--confirm` flag → mode = confirm
- `--project <name>` → project_name = <name>
- Remaining text = prompt

If prompt is empty: ask "What operations task would you like to automate or optimize?"

Load brain context for the `ops` domain (follow mastermind-protocol/SKILL.md Brain Load Procedure).

Run intake if prompt is vague (follow mastermind-intake/SKILL.md — stop at Q3, domain is already known as `ops`).

Default mode for this command: **auto** (unless `--confirm` flag present or intake Q4 says confirm).

Pick the specialist (there is no `mastermind-ops` skill package — the work is done by a picked agent). In order, per `mastermind-agent-select/SKILL.md`:
1. The prompt's `[PICK]` line, if it fits this ops task.
2. `mcp__monomind__pick({ task: prompt, kind: "both", categories: ["specialized", "engineering", "core"], top: 3 })` — use `agents.ranked[0].name`; if `skills.ranked[0]` clearly fits, load it with its `invoke`.
3. No MCP: the Standard Selection Block from `mastermind-agent-select/SKILL.md` with `CATEGORIES="specialized engineering core"`, `TOP_N=3`.
4. Nothing returned: `Workflow Optimizer`.

Spawn the picked agent via the Task tool, passing: brain_context, prompt, project_name, board_id (create if needed), mode — as a briefing that follows the Monotask Task Briefing Standard in `mastermind-protocol/SKILL.md` and includes the AGENT DELEGATION CAPABILITY block from `mastermind-delegation/SKILL.md`. In `confirm` mode, show the agent's plan or draft to the user before anything is published or sent.

After the agent returns: follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.

Invoke `Skill("mastermind-repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
