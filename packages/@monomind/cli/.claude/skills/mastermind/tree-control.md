---
name: mastermind-tree-control
description: Mastermind tree-control — pause, hold, release, or preview recovery for an issue/task tree in an org. Lets board members stop runaway loops, hold trees during review, and resume work when ready. Mirrors Paperclip's issue-tree-control API.
type: domain-skill
default_mode: confirm
---

# Mastermind Tree Control

This skill is invoked by `mastermind:tree-control` or directly via `/mastermind:tree-control`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to operate on (required)
- `issue_id`: root issue/task ID to control (required)
- `action`: preview | hold | release | cancel
- `reason`: reason for the hold/cancel (required for hold/cancel)
- `caller`: command | master

---

## Three Invariants (MUST be preserved)

All tree-control actions must respect these invariants:

1. **Productive work continues.** Only hold what genuinely needs to stop; don't block productive branches.
2. **Only real blockers stop work.** A hold is a deliberate decision, not a pseudo-stop.
3. **No infinite loops.** Release must be possible — never hold without a clear release path.

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org and Issue

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }

issuesFile=".monomind/orgs/${org_name}-issues.json"
[ ! -f "$issuesFile" ] && { echo "ERROR: No issues file found for org '${org_name}'."; exit 1; }
```

---

## Step 2 — Execute Action

### preview (default)

Preview what a hold/cancel would affect without making changes:

```bash
echo "TREE CONTROL PREVIEW — $org_name  root: $issue_id"
echo "════════════════════════════════════════════════════════"

python3 - "$issuesFile" "$issue_id" <<'PYEOF'
import json, sys

data   = json.load(open(sys.argv[1]))
rootId = sys.argv[2]
issues = {i["id"]: i for i in data.get("issues", [])}

root = issues.get(rootId)
if not root:
    print(f"ERROR: Issue '{rootId}' not found.")
    sys.exit(1)

print(f"  Root:   {root.get('id')} — {root.get('title','?')} [{root.get('status','?')}]")
print()

# Find subtree
def subtree(iid, depth=0):
    children = [i for i in issues.values() if i.get("parentId") == iid or iid in (i.get("blockedByIssueIds") or [])]
    for c in children:
        st = c.get("status","?")
        icon = "⚠" if st in ("in_progress","in_review") else "○"
        print(f"  {'  ' * depth}{icon} {c['id']} — {c.get('title','?')} [{st}]")
        subtree(c["id"], depth + 1)

subtree(rootId)

active = [i for i in issues.values()
          if i.get("status") in ("in_progress","in_review")
          and (i.get("parentId") == rootId or rootId in (i.get("blockedByIssueIds") or []))]
print()
print(f"  Active issues in subtree: {len(active)}")
print(f"  Holding root would affect all {len(active)} active issue(s).")
print()
print("  To hold: /mastermind:tree-control --org <org> --action hold --issue-id <id> --reason 'Review needed'")
print("  To cancel: /mastermind:tree-control --org <org> --action cancel --issue-id <id> --reason 'No longer needed'")
PYEOF
```

### hold

Place a hold on the issue tree (pauses all active work in the subtree):

```bash
[ -z "$reason" ] && { echo "ERROR: --reason required for hold action."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$issue_id" "$reason" "$ts" <<'PYEOF'
import json, sys

path, rootId, reason, ts = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
data = json.load(open(path))
issues = data.get("issues", [])

# Add hold metadata to root issue
held = 0
for iss in issues:
    if iss.get("id") == rootId:
        iss.setdefault("holds", []).append({
            "id": f"hold-{int(ts.replace('-','').replace(':','').replace('T','').replace('Z',''))[:14]}",
            "reason": reason,
            "createdAt": ts,
            "status": "active"
        })
        held += 1
        break

if not held:
    print(f"ERROR: Issue '{rootId}' not found.")
    sys.exit(1)

data["issues"] = issues
with open(path, "w") as f:
    json.dump(data, f, indent=2)

print(f"  HOLD PLACED on issue tree rooted at: {rootId}")
print(f"  Reason: {reason}")
print(f"  Applied: {ts}")
print()
print("  Active agents should detect the hold and pause execution.")
print(f"  To release: /mastermind:tree-control --org <org> --action release --issue-id {rootId}")
PYEOF
```

### release

Release a hold from the issue tree:

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$issue_id" "$ts" <<'PYEOF'
import json, sys

path, rootId, ts = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path))
issues = data.get("issues", [])

released = 0
for iss in issues:
    if iss.get("id") == rootId:
        holds = iss.get("holds", [])
        active_holds = [h for h in holds if h.get("status") == "active"]
        for h in active_holds:
            h["status"] = "released"
            h["releasedAt"] = ts
            released += 1
        iss["holds"] = holds
        break

if not released:
    print(f"  No active holds found on issue '{rootId}'.")
    print("  (Issue may already be running or was never held.)")
else:
    data["issues"] = issues
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"  HOLD RELEASED on {rootId} — {released} hold(s) cleared.")
    print(f"  Released: {ts}")
    print()
    print("  Agents can now resume work on this issue tree.")
PYEOF
```

### cancel

Cancel an issue and its entire subtree:

```bash
[ -z "$reason" ] && { echo "ERROR: --reason required for cancel action."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "WARNING: This will mark '$issue_id' and its subtree as cancelled."
echo "Reason: $reason"
echo ""

python3 - "$issuesFile" "$issue_id" "$reason" "$ts" <<'PYEOF'
import json, sys

path, rootId, reason, ts = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
data = json.load(open(path))
issues = data.get("issues", [])
issues_map = {i["id"]: i for i in issues}

def cancel_subtree(iid):
    iss = issues_map.get(iid)
    if not iss:
        return 0
    if iss.get("status") in ("done","cancelled"):
        return 0
    iss["status"] = "cancelled"
    iss["cancelledAt"] = ts
    iss["cancelReason"] = reason
    count = 1
    children = [i for i in issues if i.get("parentId") == iid]
    for c in children:
        count += cancel_subtree(c["id"])
    return count

cancelled = cancel_subtree(rootId)

data["issues"] = issues
with open(path, "w") as f:
    json.dump(data, f, indent=2)

print(f"  CANCELLED: {cancelled} issue(s) in tree rooted at {rootId}")
print(f"  Reason: {reason}")
print(f"  Applied: {ts}")
PYEOF
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
issue_id: <issue_id>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
