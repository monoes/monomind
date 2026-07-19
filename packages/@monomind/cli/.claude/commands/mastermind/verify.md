<!-- Run the verification gate before claiming any work is complete, fixed, or passing — evidence before assertions always. -->

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `mastermind-repeat/SKILL.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text = claim_or_task.

Load brain context for the `verify` domain (follow `mastermind-protocol/SKILL.md` Brain Load Procedure).

If claim_or_task is empty: ask "What claim or task needs verification?"

Default mode: **auto**.

---

Invoke `Skill("mastermind-verify")` passing: brain_context, claim_or_task, project_name, mode.

After skill returns: follow `mastermind-protocol/SKILL.md` Brain Write Procedure for domain `verify`.

**MANDATORY — invoke `Skill("mastermind-repeat")` now.** This is required regardless of how the skill above completed, regardless of whether you think the work is done, regardless of whether you plan to end your response. For `--repeat N`: the count is non-negotiable — all N runs must happen. For `--tillend`: only a verified empty round (confirmed by git diff) stops the loop. Do not end your response without invoking this skill.
