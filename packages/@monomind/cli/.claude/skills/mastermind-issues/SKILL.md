---
name: mastermind-issues
description: Mastermind issues — list, create, update, and close org-level issues (tasks/tickets) with search, assignee, status, and workspace filters. Mirrors Issues.tsx. For personal assigned issues use mastermind:my-issues; for issue detail use mastermind:issue-detail.
type: domain-skill
default_mode: auto
---

# Mastermind Issues

This skill is invoked by `mastermind:issues` or directly via `/mastermind:issues`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to query (required)
- `action`: list | create | update | close | search
- `issue_id`: issue ID (required for update/close)
- `query`: search term (for search)
- `status`: todo | in_progress | blocked | in_review | done | cancelled (filter)
- `assignee`: agent ID filter
- `workspace`: workspace ID filter
- `title`: issue title (for create)
- `description`: issue body (for create)
- `priority`: low | medium | high | urgent (for create/update)
- `limit`: max results (default: 50)
- `parent_id`: parent issue id, making the new issue a sub-issue (for create)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Issues File

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

issuesFile=".monomind/orgs/${org_name}-issues.json"
[ ! -f "$issuesFile" ] && echo '{"issues":[]}' > "$issuesFile"

limit="${limit:-50}"
```

Normalize any legacy records written by a pre-2.10 version of these skills. Idempotent — safe to run on every load.

```bash
python3 - "$issuesFile" <<'PYEOF'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
RENAME = {
    "assignee_id": "assigneeId", "assigned_to": "assigneeId",
    "created_at": "createdAt", "updated_at": "updatedAt",
    "closed_at": "closedAt", "project_id": "projectId",
    "parent_id": "parentId", "recovery_status": "recoveryStatus",
    "lastActivityAt": "updatedAt",
}
changed = False
for iss in data.get("issues", []):
    for old, new in RENAME.items():
        if old in iss:
            iss.setdefault(new, iss.pop(old))
            iss.pop(old, None)
            changed = True
    if iss.get("status") == "open":
        iss["status"] = "todo"
        changed = True
if changed:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    import os; os.replace(tmp, path)
PYEOF
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "ISSUES — $org_name"
echo "────────────────────────────────────────────────────────"

python3 - "$issuesFile" "${status:-}" "${assignee:-}" "${workspace:-}" "$limit" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
status_f    = sys.argv[2]
assignee_f  = sys.argv[3]
workspace_f = sys.argv[4]
limit       = int(sys.argv[5])

issues = data.get("issues", [])
if status_f:
    issues = [i for i in issues if i.get("status") == status_f]
if assignee_f:
    issues = [i for i in issues if i.get("assigneeId") == assignee_f]
if workspace_f:
    issues = [i for i in issues if i.get("workspaceId") == workspace_f]

issues = issues[:limit]

if not issues:
    print("  (no issues match filters)")
else:
    print(f"  {'ID':<28} {'STATUS':<14} {'PRI':<8} {'TITLE':<38} ASSIGNEE")
    print("  " + "─" * 102)
    for iss in issues:
        iid   = iss.get("id","?")[:28]
        st    = iss.get("status","todo")[:14]
        pri   = iss.get("priority","medium")[:8]
        title = (iss.get("title") or "-")[:38]
        asgn  = (iss.get("assigneeTitle") or iss.get("assigneeId") or "—")[:20]
        print(f"  {iid:<28} {st:<14} {pri:<8} {title:<38} {asgn}")

print(f"\n  Showing {len(issues)} issue(s).")
PYEOF

echo ""
echo "  Create: /mastermind:issues --org $org_name --action create --title 'My Issue'"
echo "  Detail: /mastermind:issue-detail --org $org_name --issue-id <id>"
```

### search

```bash
[ -z "$query" ] && { echo "ERROR: --query required."; exit 1; }

q=$(echo "$query" | tr '[:upper:]' '[:lower:]')

echo "ISSUE SEARCH — $org_name  query: '$query'"
echo "────────────────────────────────────────────────────────"

python3 - "$issuesFile" "$q" "$limit" <<'PYEOF'
import json, sys
data  = json.load(open(sys.argv[1]))
q     = sys.argv[2]
limit = int(sys.argv[3])

issues = data.get("issues", [])
matched = [i for i in issues
  if q in (i.get("title") or "").lower()
  or q in (i.get("description") or "").lower()
  or q in (i.get("id") or "").lower()][:limit]

if not matched:
    print(f"  (no issues match '{q}')")
else:
    for iss in matched:
        iid   = iss.get("id","?")
        title = iss.get("title","-")
        st    = iss.get("status","?")
        print(f"  [{st}] {iid}  {title}")

print(f"\n  {len(matched)} match(es).")
PYEOF
```

### create

```bash
[ -z "$title" ] && { echo "ERROR: --title required."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
newId="issue-$(python3 -c 'import time; print(int(time.time()*1000))')-001"

python3 - "$issuesFile" "$newId" "$title" "${description:-}" "${priority:-medium}" "${assignee:-}" "${workspace:-}" "${parent_id:-}" "$ts" <<'PYEOF'
import json, os, sys
path, iid, title, desc, pri, asgn, ws, parent, ts = sys.argv[1:]

VALID_PRIORITY = {"low","medium","high","urgent"}
if pri not in VALID_PRIORITY:
    print(f"ERROR: priority '{pri}' must be one of {sorted(VALID_PRIORITY)}.")
    sys.exit(1)

data = json.load(open(path))
issues = data.setdefault("issues", [])

if parent and not any(i.get("id") == parent for i in issues):
    print(f"ERROR: parent issue '{parent}' not found.")
    sys.exit(1)

issue = {
    "id": iid, "title": title, "description": desc,
    "status": "todo", "priority": pri,
    "assigneeId": asgn or None,
    "assigneeAgentId": None, "assigneeUserId": None,
    "parentId": parent or None,
    "projectId": None, "workspaceId": ws or None,
    "blockedByIssueIds": [],
    "createdAt": ts, "updatedAt": ts,
}
issues.append(issue)
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
print(f"  Created: {iid}")
print(f"  Title:   {title}")
print(f"  Status:  todo  |  Priority: {pri}" + (f"  |  Parent: {parent}" if parent else ""))
PYEOF
```

### update

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$issue_id" "${status:-}" "${priority:-}" "${title:-}" "$ts" <<'PYEOF'
import json, os, sys
path, iid, new_st, new_pri, new_title, ts = sys.argv[1:]

VALID_STATUS   = {"todo","in_progress","blocked","in_review","done","cancelled"}
VALID_PRIORITY = {"low","medium","high","urgent"}
if new_st and new_st not in VALID_STATUS:
    print(f"ERROR: status '{new_st}' must be one of {sorted(VALID_STATUS)}.")
    sys.exit(1)
if new_pri and new_pri not in VALID_PRIORITY:
    print(f"ERROR: priority '{new_pri}' must be one of {sorted(VALID_PRIORITY)}.")
    sys.exit(1)

data = json.load(open(path))
issues = data.get("issues", [])
found = False
for iss in issues:
    if iss.get("id") == iid:
        if new_st:    iss["status"] = new_st
        if new_pri:   iss["priority"] = new_pri
        if new_title: iss["title"] = new_title
        iss["updatedAt"] = ts
        found = True
        break
if not found:
    print(f"ERROR: Issue '{iid}' not found.")
    sys.exit(1)
data["issues"] = issues
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
print(f"  Updated: {iid}  (updatedAt: {ts})")
PYEOF
```

### close

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$issue_id" "$ts" <<'PYEOF'
import json, os, sys
path, iid, ts = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(path))
issues = data.get("issues", [])
found = False
for iss in issues:
    if iss.get("id") == iid:
        iss["status"] = "done"
        iss["closedAt"] = ts
        iss["updatedAt"] = ts
        found = True
        break
if not found:
    print(f"ERROR: Issue '{iid}' not found.")
    sys.exit(1)
data["issues"] = issues
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
print(f"  Closed: {iid}  (closedAt: {ts})")
PYEOF
```

---

## Step 2.5 — Append Activity Record

After any `create`, `update`, or `close` action succeeds, append one line to the org's
activity log. This is the only writer for `<org>-activity.jsonl`; seven skills read it.

```bash
activityFile=".monomind/orgs/${org_name}-activity.jsonl"
jq -cn \
  --arg iid "${affected_issue_id}" \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg st "${resulting_status}" \
  --arg ag "${assignee:-operator}" \
  --arg act "${action}" \
  --arg sm "${action} ${affected_issue_id}" \
  '{issue_id:$iid, ts:$ts, status:$st, tokens:null, agent:$ag, type:$act, summary:$sm}' \
  >> "$activityFile"
```

`affected_issue_id` is `$newId` for `create` and `$issue_id` for `update`/`close`;
`resulting_status` is `todo`, the new status, or `done` respectively.

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.
