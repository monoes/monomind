---
name: mastermind-approve
description: Review and action pending approval requests from agents in a running org.
---

**If $ARGUMENTS is empty:** Output the following and wait.

---

**MASTERMIND: APPROVE**

Review and action pending approval requests from agents running inside an autonomous org. Agents request human approval before executing sensitive actions (publishing content, sending emails, making purchases, modifying infrastructure).

**Usage:**

```
/mastermind:approve --org <name>                   List all pending approvals
/mastermind:approve --org <name> --action approve --id <id>
/mastermind:approve --org <name> --action reject  --id <id> --reason "Too risky"
/mastermind:approve --org <name> --action inspect --id <id>
```

**Options:**
`--org <name>` — org to check (required)
`--action list|approve|reject|inspect` — what to do (default: list)
`--id <approval_id>` — specific approval to approve/reject/inspect
`--reason <text>` — reason for rejection (optional)

No running orgs yet? Run `/mastermind:createorg` then `/mastermind:runorg`.

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--org <name>` → org_name = <name>
- `--action <action>` → action = <action> (default: "list")
- `--id <id>` → approval_id = <id>
- `--reason <text>` → reason = <text>
- Remaining text = additional context

If `--org` is not provided, list running orgs and ask which to check:
```bash
orgs=$(ls .monomind/orgs/*.json 2>/dev/null | xargs -I{} basename {} .json 2>/dev/null | grep -v "\-state\|-goals\|-routines\|-approvals\|-issues\|-members\|-projects")
if [ -z "$orgs" ]; then
  echo "No saved orgs found. Run /mastermind:createorg first."
  exit 1
fi
echo "Available orgs: $orgs"
```
Ask: "Which org would you like to check approvals for?"

Validate the org file exists:
```bash
[ -f ".monomind/orgs/${org_name}.json" ] || { echo "Org '${org_name}' not found."; exit 1; }
```

Load brain context for the `ops` domain (follow _protocol.md Brain Load Procedure, namespace: `ops`).

Generate a session ID:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
session_id="mm-$(date -u +%Y%m%dT%H%M%S)"
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
```

Emit `session:start`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$org_name" \
    --arg proj "$(pwd)" \
    '{type:"session:start",session:$session,domain:"ops",prompt:("Approve requests for org: "+$org),mode:"confirm",project:$proj,ts:(now*1000|floor)}')" || true
```

Invoke `Skill("mastermind:approve")` passing: brain_context, org_name, action, approval_id, reason, caller: "command".

After skill returns: note the status. Emit `session:complete`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg status "<status>" \
    '{type:"session:complete",session:$session,domain:"ops",status:$status,domains:["ops"],ts:(now*1000|floor)}')" || true
```

Follow _protocol.md Brain Write Procedure for domain `ops`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
