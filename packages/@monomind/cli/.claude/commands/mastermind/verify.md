---
name: mastermind-verify
description: Run the verification gate before claiming any work is complete, fixed, or passing — evidence before assertions always.
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`.

Parse `$ARGUMENTS` for `--auto`, `--confirm`, `--project <name>`, and remaining text = claim_or_task.

Load brain context for the `verify` domain (follow `_protocol.md` Brain Load Procedure).

If claim_or_task is empty: ask "What claim or task needs verification?"

Default mode: **auto**.

---

Invoke `Skill("mastermind:verify")` passing: brain_context, claim_or_task, project_name, mode.

After skill returns: follow `_protocol.md` Brain Write Procedure for domain `verify`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
