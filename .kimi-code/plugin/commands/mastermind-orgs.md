---
description: mastermind orgs command (monomind)
---

<!-- List all saved orgs with their runtime status, schedule, and last run time. Flags crashed runs and legacy-format config files. -->

**If $ARGUMENTS is empty:** Execute the listing below directly.

---

**MASTERMIND: ORGS**

Lists all saved orgs.

---

Parse `$ARGUMENTS` for:
- No flags expected — this command takes no arguments.

Execute `Skill("mastermind-orgs")` passing: caller: "command".

Invoke `Skill("mastermind-repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
