---
name: mastermind-orgs
description: List all saved orgs with their status, schedule interval, and last/next run times. Shows stopped/active/paused state for scheduled orgs.
---

**If $ARGUMENTS is empty:** Execute the listing below directly.

---

**MASTERMIND: ORGS**

Lists all saved orgs.

---

Parse `$ARGUMENTS` for:
- No flags expected — this command takes no arguments.

Execute `Skill("mastermind:orgs")` passing: caller: "command".

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
