---
name: mastermind-approval-detail
description: Mastermind approval-detail — deep inspection and action on a single approval request. View approval metadata, payload, comments, linked issues, and perform approve/reject/revision/resubmit actions. Mirrors ApprovalDetail.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Approval Detail

This skill is invoked by `mastermind:approval-detail` or directly via `/mastermind:approval-detail`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the approval belongs to (required)
- `approval_id`: approval id or short prefix (required)
- `action`: show | comments | linked-issues | comment | approve | reject | request-revision | resubmit
- `comment_body`: comment text (for comment action)
- `caller`: command | master

---

## Approval Statuses

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting review — actionable |
| `approved` | Approved and resolved |
| `rejected` | Rejected and resolved |
| `revision_requested` | Agent asked to revise — still actionable |
| `resubmitted` | Agent resubmitted after revision |

---

## Approval Types

| Type | Description |
|------|-------------|
| `budget_override_required` | Agent needs to exceed budget cap |
| `agent_hire` | Agent is requesting to hire another agent |
| `tool_grant` | Agent requests a new tool permission |
| `action_confirm` | Agent requests confirmation before a destructive action |
| `custom` | Plugin-defined approval type |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Approval

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

approvalsFile=".monomind/orgs/${org_name}-approvals.json"
[ ! -f "$approvalsFile" ] && { echo "ERROR: No approvals file for org '${org_name}'."; exit 1; }

# Find approval by full id or prefix
approvalDef=$(jq -r --arg id "$approval_id" \
  '(.approvals // [])[] | select(.id == $id or (.id | startswith($id)))' \
  "$approvalsFile" | head -1)
[ -z "$approvalDef" ] && { echo "ERROR: Approval '${approval_id}' not found."; exit 1; }

approvalId=$(echo "$approvalDef" | jq -r '.id')
commentsFile=".monomind/orgs/${org_name}-approval-comments.jsonl"
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "APPROVAL — ${approvalId}"
echo "────────────────────────────────────────────────────────"

echo "$approvalDef" | jq -r '
  "  ID:         \(.id)",
  "  Type:       \(.type // "unknown")",
  "  Status:     \(.status // "pending")",
  "  Agent:      \(.agentId // "(unknown)")",
  "  Created:    \(.createdAt // "-")",
  "  Resolved:   \(.resolvedAt // "-")"
'

echo ""
echo "PAYLOAD"
echo "────────────────────────────────────────────────────────"
echo "$approvalDef" | jq -r '.payload // {}' | jq .

status=$(echo "$approvalDef" | jq -r '.status // "pending"')
if [ "$status" = "pending" ] || [ "$status" = "revision_requested" ]; then
  echo ""
  echo "ACTIONS AVAILABLE"
  echo "  approve:          --action approve"
  echo "  reject:           --action reject"
  echo "  request revision: --action request-revision"
  echo "  add comment:      --action comment --comment-body 'your notes'"
fi
```

### comments

```bash
echo "COMMENTS — ${approvalId}"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$commentsFile" ]; then
  echo "  No comments."
else
  count=$(grep -c "\"approvalId\":\"${approvalId}\"" "$commentsFile" 2>/dev/null || echo 0)
  echo "  Total: $count"
  echo ""
  grep "\"approvalId\":\"${approvalId}\"" "$commentsFile" 2>/dev/null | while IFS= read -r line; do
    author=$(echo "$line" | jq -r '.authorType // "user"')
    body=$(echo "$line" | jq -r '.body // ""')
    ts=$(echo "$line" | jq -r '.createdAt // "-"')
    echo "  [$ts] ($author)"
    echo "  $body"
    echo ""
  done
fi
```

### linked-issues

```bash
issuesFile=".monomind/orgs/${org_name}-issues.json"
echo "LINKED ISSUES — ${approvalId}"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-12s %s\n" "ID" "STATUS" "TITLE"
echo "────────────────────────────────────────────────────────"

linkedIds=$(echo "$approvalDef" | jq -r '(.linkedIssueIds // [])[]')
if [ -z "$linkedIds" ]; then
  echo "  No linked issues."
else
  if [ -f "$issuesFile" ]; then
    echo "$linkedIds" | while read -r iid; do
      row=$(jq -r --arg id "$iid" '(.issues // [])[] | select(.id == $id) | [.id, (.status // "open"), (.title // "(no title)")] | @tsv' "$issuesFile")
      [ -n "$row" ] && echo "$row" | while IFS=$'\t' read -r id st title; do
        printf "%-24s %-12s %s\n" "$id" "$st" "$title"
      done || printf "%-24s %-12s %s\n" "$iid" "(unknown)" "(not found)"
    done
  fi
fi
```

### comment

```bash
[ -z "$comment_body" ] && { echo "ERROR: --comment-body required."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
entry=$(jq -n \
  --arg aid "$approvalId" \
  --arg org "$org_name" \
  --arg body "$comment_body" \
  --arg ts "$ts" \
  '{"approvalId":$aid,"org":$org,"authorType":"operator","body":$body,"createdAt":$ts}')

echo "$entry" >> "$commentsFile"

echo "Comment added to approval ${approvalId}."
echo "  Body: $comment_body"
echo "  At:   $ts"
```

### approve

```bash
status=$(echo "$approvalDef" | jq -r '.status // "pending"')
if [ "$status" != "pending" ] && [ "$status" != "revision_requested" ]; then
  echo "ERROR: Approval is in status '$status' — cannot approve."
  exit 1
fi

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${approvalsFile}.tmp"
jq --arg id "$approvalId" --arg ts "$ts" \
  '.approvals = [(.approvals // [])[] | if .id == $id then
     .status = "approved" | .resolvedAt = $ts | .resolvedBy = "operator"
   else . end]' \
  "$approvalsFile" > "$tmp" && mv "$tmp" "$approvalsFile"

echo "Approval '${approvalId}' APPROVED."
echo "  Resolved at: $ts"
echo "  Agent will be notified to proceed."
```

### reject

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${approvalsFile}.tmp"
jq --arg id "$approvalId" --arg ts "$ts" \
  '.approvals = [(.approvals // [])[] | if .id == $id then
     .status = "rejected" | .resolvedAt = $ts | .resolvedBy = "operator"
   else . end]' \
  "$approvalsFile" > "$tmp" && mv "$tmp" "$approvalsFile"

echo "Approval '${approvalId}' REJECTED."
echo "  Resolved at: $ts"
```

### request-revision

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${approvalsFile}.tmp"
jq --arg id "$approvalId" --arg ts "$ts" \
  '.approvals = [(.approvals // [])[] | if .id == $id then
     .status = "revision_requested" | .revisionRequestedAt = $ts
   else . end]' \
  "$approvalsFile" > "$tmp" && mv "$tmp" "$approvalsFile"

echo "Revision requested for approval '${approvalId}'."
echo "  Agent will be notified to revise and resubmit."
```

### resubmit

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${approvalsFile}.tmp"
jq --arg id "$approvalId" --arg ts "$ts" \
  '.approvals = [(.approvals // [])[] | if .id == $id then
     .status = "pending" | .resubmittedAt = $ts
   else . end]' \
  "$approvalsFile" > "$tmp" && mv "$tmp" "$approvalsFile"

echo "Approval '${approvalId}' resubmitted (status reset to pending)."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
approval_id: <approval_id>
approval_status: <status>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
