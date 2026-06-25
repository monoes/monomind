---
name: mastermind-orgstatus
description: Show detailed status for a single org — lifecycle state, schedule, last/next run, recent activity, and roles. For scheduled orgs shows loop health.
---

**If $ARGUMENTS is empty:** Output the following and wait.

---

**MASTERMIND: ORG STATUS**

Shows detailed status for a saved org.

**Usage:**

```
/mastermind:orgstatus --org <name>
```

**Examples:**

```
/mastermind:orgstatus --org livarto-issue-resolver
/mastermind:orgstatus --org newsroom
```

Your saved orgs:

```bash
ls .monomind/orgs/*.json 2>/dev/null | grep -v -- '-approvals\|-state\|-activity' | \
  xargs -I{} basename {} .json 2>/dev/null || echo "(none — run /mastermind:createorg to define one)"
```

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--org <name>` → org_name = <name>

If `--org` is not provided, list orgs and ask which to inspect.

Verify the org file exists:
```bash
[ -f ".monomind/orgs/${org_name}.json" ] || { echo "Org '${org_name}' not found."; exit 1; }
```

Generate a session ID:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
session_id="mm-$(date -u +%Y%m%dT%H%M%S)"
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
```

Invoke `Skill("mastermind:orgstatus")` passing: org_name: `$org_name`, caller: "command".

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
