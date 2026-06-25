---
name: mastermind-liveness
description: Mastermind liveness — enforce the non-terminal issue liveness contract for agent-owned work. Checks if every in_progress/blocked/in_review issue has a valid action path (active run, queued wake, explicit blocker, or recovery action). Can checkout an issue to an agent run, release checkout, trigger wakeup decisions, and file explicit recovery actions for stalled issues. Based on Paperclip's execution-semantics.md liveness contract.
type: domain-skill
default_mode: auto
---

# Mastermind Liveness

This skill is invoked by `mastermind:liveness` or directly via `/mastermind:liveness`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to check (required)
- `action`: check | checkout | release | wakeup | recover
- `issue_id`: specific issue to operate on (required for checkout/release/wakeup/recover)
- `agent_id`: agent claiming checkout (required for checkout)
- `run_id`: execution run ID (required for checkout)
- `reason`: recovery reason (required for recover)
- `caller`: command | master

---

## Liveness Contract

An issue is **healthy** when the product can answer "what moves this forward next?" without requiring a human to reconstruct intent.

An issue is **stalled** when it is non-terminal but has no:
- active run linked to the issue
- queued wake or continuation deliverable to the responsible agent
- explicit execution-policy participant
- pending interaction waiting on a specific responder
- one-shot monitor (`nextCheckAt`) that will wake the assignee
- human owner (`assigneeUserId`)
- first-class blocker chain whose leaf issues are themselves healthy
- open explicit recovery action naming owner + next action

**Valid non-terminal statuses for agent-owned work:** `todo`, `in_progress`, `blocked`, `in_review`

**Status → execution expectation:**
- `todo`: actionable but not yet claimed — may still need wake path to assignee
- `in_progress`: must have agent assignee + active execution backing (strict)
- `blocked`: must have named external dependency (blockedByIssueIds) or explicit human decision needed
- `in_review`: review participant must be named; next move belongs to reviewer

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org and Issues

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

issuesFile=".monomind/orgs/${org_name}-issues.json"
stateFile=".monomind/orgs/${org_name}-state.json"
```

---

## Step 2 — Execute Action

### check (default)

Audit every non-terminal agent-owned issue for liveness. Flag stalled issues.

```bash
echo "LIVENESS CHECK — ${org_name}"
echo "════════════════════════════════════════════════════════"

python3 - "$issuesFile" "$stateFile" <<'PYEOF'
import json, sys, os
from datetime import datetime, timedelta

issues_path = sys.argv[1]
state_path  = sys.argv[2]

# Load issues
if not os.path.exists(issues_path):
    print("  No issues file found. Org has no tracked issues.")
    sys.exit(0)

data   = json.load(open(issues_path))
issues = data.get("issues", [])

# Load active agent run IDs from state
active_runs = set()
if os.path.exists(state_path):
    try:
        state = json.load(open(state_path))
        for role in state.get("roles", []):
            if role.get("currentRunId"): active_runs.add(role["currentRunId"])
    except: pass

non_terminal_statuses = {"todo","in_progress","blocked","in_review"}
terminal_statuses     = {"done","cancelled"}

healthy, stalled, warnings = [], [], []
now = datetime.utcnow()

for iss in issues:
    status = iss.get("status","")
    if status in terminal_statuses or status not in non_terminal_statuses:
        continue

    aId = iss.get("assigneeAgentId") or iss.get("assigneeId")
    uId = iss.get("assigneeUserId")
    iid = iss.get("id","?")
    title = iss.get("title","?")[:50]

    # User-owned: skip strict execution checks
    if uId and not aId:
        healthy.append((iid, title, status, "user-owned"))
        continue

    # Evaluate liveness
    paths = []

    run_id = iss.get("executionRunId") or iss.get("checkoutRunId")
    if run_id and run_id in active_runs:
        paths.append("active-run")

    blockers = iss.get("blockedByIssueIds") or []
    if status == "blocked" and blockers:
        unresolved = [b for b in blockers if b not in
                      {i["id"] for i in issues if i.get("status") in terminal_statuses}]
        if unresolved:
            paths.append(f"blocked-by:{','.join(unresolved[:2])}")
        else:
            # All blockers resolved — should transition
            warnings.append((iid, title, status, "all blockers resolved but issue still blocked"))

    if iss.get("executionPolicy", {}).get("monitor", {}).get("nextCheckAt"):
        paths.append("monitor")

    if iss.get("recoveryActions") and any(
        r.get("status") not in ("resolved","cancelled")
        for r in iss.get("recoveryActions",[])
    ):
        paths.append("recovery-action")

    if iss.get("currentParticipant"):
        paths.append("participant")

    # Stale heartbeat check (in_progress with no run and no recent update)
    if status == "in_progress" and aId and not paths:
        updated = iss.get("updatedAt","")
        if updated:
            try:
                age = now - datetime.fromisoformat(updated[:19])
                if age > timedelta(hours=2):
                    stalled.append((iid, title, status, f"in_progress {int(age.total_seconds()//3600)}h with no active path"))
                    continue
            except: pass
        stalled.append((iid, title, status, "in_progress with no active execution path"))
        continue

    if not paths and status == "todo" and aId:
        warnings.append((iid, title, status, "todo assigned to agent — may need wakeup"))
    elif paths:
        healthy.append((iid, title, status, " + ".join(paths)))
    else:
        healthy.append((iid, title, status, "no agent assignee"))

print(f"  ✓ Healthy: {len(healthy)}")
if healthy:
    for iid, t, s, p in healthy[:5]:
        print(f"    {iid}: [{s}] {t} — {p}")
    if len(healthy) > 5: print(f"    … {len(healthy)-5} more")

print()
if stalled:
    print(f"  ✗ STALLED: {len(stalled)}")
    for iid, t, s, p in stalled:
        print(f"    {iid}: [{s}] {t}")
        print(f"      → {p}")
    print()
    print("  Fix: /mastermind:liveness --org <org> --action recover --issue-id <id> --reason 'execution path lost'")
else:
    print("  ✓ No stalled issues.")

if warnings:
    print()
    print(f"  ⚠ Warnings: {len(warnings)}")
    for iid, t, s, p in warnings:
        print(f"    {iid}: [{s}] {t} — {p}")
PYEOF
```

### checkout

Claim an issue for execution by an agent run. Sets `checkoutRunId` and `executionRunId`.

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }
[ -z "$agent_id" ] && { echo "ERROR: --agent-id required."; exit 1; }
[ -z "$run_id"   ] && { echo "ERROR: --run-id required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$issue_id" "$agent_id" "$run_id" "$ts" <<'PYEOF'
import json, sys

path, iid, agentId, runId, ts = sys.argv[1:]
data = json.load(open(path))
issues = data.get("issues", [])

found = False
for iss in issues:
    if iss.get("id") == iid:
        existing = iss.get("checkoutRunId")
        if existing and existing != runId:
            print(f"  CONFLICT: Issue already checked out by run {existing}")
            print(f"  Release first: /mastermind:liveness --org <org> --action release --issue-id {iid}")
            sys.exit(1)
        iss["checkoutRunId"]  = runId
        iss["executionRunId"] = runId
        iss["assigneeId"]     = agentId
        iss["assigneeAgentId"]= agentId
        iss["status"]         = "in_progress"
        iss["checkedOutAt"]   = ts
        iss["updatedAt"]      = ts
        found = True
        print(f"  CHECKOUT: Issue {iid} → agent {agentId}, run {runId}")
        print(f"  Status set to: in_progress")
        break

if not found:
    print(f"  ERROR: Issue '{iid}' not found.")
    sys.exit(1)

data["issues"] = issues
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
```

### release

Release the checkout lock on an issue.

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$issue_id" "$ts" "${run_id:-}" <<'PYEOF'
import json, sys, os

path, iid, ts, run_id = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
data = json.load(open(path))
issues = data.get("issues", [])

for iss in issues:
    if iss.get("id") == iid:
        current = iss.get("checkoutRunId","")
        if run_id and current != run_id:
            print(f"  WARNING: Releasing run {run_id} but issue has run {current}. Proceeding.")
        iss.pop("checkoutRunId", None)
        iss.pop("executionRunId", None)
        iss.pop("checkedOutAt", None)
        iss["updatedAt"] = ts
        print(f"  RELEASED: Checkout cleared for issue {iid}")
        print(f"  Status remains: {iss.get('status','?')} — update separately if needed.")
        data["issues"] = issues
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        sys.exit(0)

print(f"  ERROR: Issue '{iid}' not found.")
sys.exit(1)
PYEOF
```

### wakeup

Decide whether the assignee of a `todo` or `blocked` issue should be woken.

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }

python3 - "$issuesFile" "$stateFile" "$issue_id" "${agent_id:-}" <<'PYEOF'
import json, sys, os

issues_path, state_path, iid, actor_agent_id = sys.argv[1:]

data = json.load(open(issues_path))
iss = next((i for i in data.get("issues",[]) if i.get("id") == iid), None)
if not iss:
    print(f"  ERROR: Issue '{iid}' not found.")
    sys.exit(1)

checkout_agent = iss.get("assigneeAgentId") or iss.get("assigneeId","")
checkout_run   = iss.get("checkoutRunId","")

# Port of Paperclip's shouldWakeAssigneeOnCheckout logic
actor_is_agent     = bool(actor_agent_id)
actor_differs      = actor_agent_id != checkout_agent
checkout_has_no_run= not checkout_run

should_wake = (
    not actor_is_agent          # non-agent actor (board/human) → always wake
    or actor_differs            # different agent claiming → wake original
    or checkout_has_no_run      # no active run → wake to get work started
)

print(f"  Issue:   {iid} — {iss.get('title','?')[:60]}")
print(f"  Status:  {iss.get('status','?')}")
print(f"  Assignee:{checkout_agent or '(none)'}")
print(f"  Run:     {checkout_run or '(none)'}")
print(f"  Actor:   {actor_agent_id or '(board)'}")
print()
if should_wake:
    print("  WAKE: YES — assignee should be notified to pick up this issue.")
    print("  Reasons:")
    if not actor_is_agent:           print("    · Non-agent actor (board/human)")
    if actor_is_agent and actor_differs: print(f"    · Actor ({actor_agent_id}) != assignee ({checkout_agent})")
    if checkout_has_no_run:          print("    · No active execution run")
else:
    print("  WAKE: NO — assignee already has an active run for this issue.")
PYEOF
```

### recover

File an explicit recovery action on a stalled issue with a named owner and next step.

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }
[ -z "$reason"   ] && { echo "ERROR: --reason required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
recoveryId="recovery-$(python3 -c 'import time; print(int(time.time()*1000))')"

python3 - "$issuesFile" "$issue_id" "$recoveryId" "${agent_id:-operator}" "$reason" "$ts" <<'PYEOF'
import json, sys

path, iid, rid, owner, cause, ts = sys.argv[1:]
data = json.load(open(path))
issues = data.get("issues", [])

for iss in issues:
    if iss.get("id") == iid:
        recovery = {
            "id": rid,
            "kind": "restore-liveness",
            "owner": owner,
            "cause": cause,
            "createdAt": ts,
            "status": "open",
            "nextAction": f"Investigate why issue '{iid}' has no active execution path and restore it.",
        }
        iss.setdefault("recoveryActions", []).append(recovery)
        iss["status"] = "blocked"
        iss["updatedAt"] = ts
        data["issues"] = issues
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  RECOVERY ACTION FILED: {rid}")
        print(f"  Issue {iid} → status: blocked (pending recovery)")
        print(f"  Owner: {owner}")
        print(f"  Cause: {cause}")
        print(f"  Resolve with: /mastermind:liveness --org <org> --action checkout --issue-id {iid} --agent-id <id> --run-id <id>")
        sys.exit(0)

print(f"  ERROR: Issue '{iid}' not found.")
sys.exit(1)
PYEOF
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
issue_id: <issue_id or all>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
