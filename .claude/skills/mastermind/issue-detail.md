---
name: mastermind-issue-detail
description: Mastermind issue-detail — deep per-issue/task inspection and management. Show thread summary, run history, comments, sub-issues, file attachments, assign, close, and recovery actions for a single task within an org.
type: domain-skill
default_mode: auto
---

# Mastermind Issue Detail

This skill is invoked by `mastermind:issue-detail` or directly via `/mastermind:issue-detail`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the issue belongs to (required)
- `issue_id`: issue id/slug (required)
- `action`: show | thread | runs | sub-issues | attachments | comment | assign | close | reopen | recover
- `comment_body`: comment text (required for comment action)
- `assignee_id`: agent id to assign (required for assign action)
- `recovery_action`: accept | reject (for recover action)
- `days`: lookback window for run history (default 14)
- `caller`: command | master

---

## Issue Status Flow

```
open → in_progress → done
         ↓
      blocked → in_progress
         ↓
    cancelled
```

Recovery actions apply when an issue enters `needs_recovery` state after a failed run.

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Issue Data

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

issuesFile=".monomind/orgs/${org_name}-issues.json"
[ ! -f "$issuesFile" ] && { echo "ERROR: No issues file for org '$org_name'. Create tasks via /mastermind:tasks."; exit 1; }

issueDef=$(jq -r --arg id "$issue_id" '.issues[] | select(.id == $id or .slug == $id)' "$issuesFile")
[ -z "$issueDef" ] && { echo "ERROR: Issue '$issue_id' not found in org '$org_name'."; exit 1; }

resolvedId=$(echo "$issueDef" | jq -r '.id')
activityFile=".monomind/orgs/${org_name}-activity.jsonl"
threadFile=".monomind/orgs/${org_name}-threads.jsonl"
days=${days:-14}
cutoff=$(date -u -v-${days}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "${days} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "ISSUE DETAIL — $issue_id @ $org_name"
echo "────────────────────────────────────────────────────────"

echo "$issueDef" | jq -r '
  "  ID:            \(.id)",
  "  Title:         \(.title // "(no title)")",
  "  Status:        \(.status // "open")",
  "  Priority:      \(.priority // "medium")",
  "  Assignee:      \(.assignee_id // "(unassigned)")",
  "  Project:       \(.project_id // "(none)")",
  "  Created:       \(.created_at // "-")",
  "  Updated:       \(.updated_at // "-")"
'

# Sub-issues
subCount=$(jq --arg pid "$resolvedId" '[.issues[] | select(.parent_id == $pid)] | length' "$issuesFile" 2>/dev/null || echo 0)
echo "  Sub-issues:    $subCount"

# Attachments
attCount=$(echo "$issueDef" | jq -r '(.attachments // []) | length')
echo "  Attachments:   $attCount"

# Recovery
recoveryStatus=$(echo "$issueDef" | jq -r '.recovery_status // "none"')
[ "$recoveryStatus" != "none" ] && echo "" && echo "  RECOVERY STATUS: $recoveryStatus"

# Description
desc=$(echo "$issueDef" | jq -r '.description // ""')
if [ -n "$desc" ]; then
  echo ""
  echo "DESCRIPTION"
  echo "────────────────────────────────────────────────────────"
  echo "$desc" | head -10
fi
```

### thread

```bash
echo "THREAD — $issue_id"
echo "────────────────────────────────────────────────────────"

found=0
if [ -f "$threadFile" ]; then
  while IFS= read -r line; do
    iid=$(echo "$line" | jq -r '.issue_id // ""')
    [ "$iid" != "$resolvedId" ] && continue
    ts=$(echo "$line" | jq -r '.ts // ""')
    role=$(echo "$line" | jq -r '.role // "agent"')
    body=$(echo "$line" | jq -r '.body // ""' | head -3)
    msgType=$(echo "$line" | jq -r '.type // "message"')
    printf "\n  [%s] %-10s (%s)\n" "$ts" "$role" "$msgType"
    echo "$body" | while IFS= read -r l; do echo "    $l"; done
    found=$((found + 1))
  done < "$threadFile"
fi

[ "$found" -eq 0 ] && echo "  No thread messages for this issue."
echo ""
echo "  $found message(s). To add a comment: --action comment --comment-body '...'"
```

### runs

```bash
echo "RUN HISTORY — $issue_id (last ${days} days)"
echo "────────────────────────────────────────────────────────"
printf "%-26s %-12s %-8s %-14s %s\n" "TIMESTAMP" "STATUS" "TOKENS" "AGENT" "SUMMARY"
echo "────────────────────────────────────────────────────────"

found=0
if [ -f "$activityFile" ]; then
  while IFS= read -r line; do
    iid=$(echo "$line" | jq -r '.issue_id // ""')
    [ "$iid" != "$resolvedId" ] && continue
    ts=$(echo "$line" | jq -r '.ts // ""')
    [ -n "$cutoff" ] && [ "$ts" \< "$cutoff" ] && continue
    st=$(echo "$line" | jq -r '.status // "-"')
    tok=$(echo "$line" | jq -r '.tokens // "-"')
    ag=$(echo "$line" | jq -r '.agent // "-"')
    summary=$(echo "$line" | jq -r '.summary // .type // "-"' | cut -c1-30)
    printf "%-26s %-12s %-8s %-14s %s\n" "$ts" "$st" "$tok" "$ag" "$summary"
    found=$((found + 1))
  done < "$activityFile"
fi

[ "$found" -eq 0 ] && echo "  No runs found in the last $days days."
```

### sub-issues

```bash
echo "SUB-ISSUES — $issue_id"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-12s %-10s %s\n" "ID" "STATUS" "PRIORITY" "TITLE"
echo "────────────────────────────────────────────────────────"

count=0
jq -r --arg pid "$resolvedId" '.issues[] | select(.parent_id == $pid) |
  [.id, (.status // "open"), (.priority // "medium"), (.title // "(no title)")] | @tsv' \
  "$issuesFile" 2>/dev/null | while IFS=$'\t' read -r id st pri title; do
  printf "%-24s %-12s %-10s %s\n" "$id" "$st" "$pri" "$title"
  count=$((count + 1))
done

echo ""
echo "To create a sub-issue: /mastermind:tasks --org $org_name --action create --parent-id $issue_id"
```

### attachments

```bash
echo "ATTACHMENTS — $issue_id"
echo "────────────────────────────────────────────────────────"
atts=$(echo "$issueDef" | jq -r '(.attachments // [])[]' 2>/dev/null)
if [ -z "$atts" ]; then
  echo "  No attachments."
else
  echo "$issueDef" | jq -r '(.attachments // [])[] |
    "  [\(.type // "file")] \(.name // .path // "unnamed") — \(.size_bytes // "?") bytes — added \(.added_at // "?")"'
fi
```

### comment

```bash
[ -z "$comment_body" ] && { echo "ERROR: --comment-body required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

entry=$(jq -cn --arg iid "$resolvedId" --arg body "$comment_body" --arg ts "$ts" \
  '{"issue_id":$iid,"role":"user","type":"comment","body":$body,"ts":$ts}')
echo "$entry" >> "$threadFile"

echo "Comment added to issue '$issue_id'."
echo "  Body: $comment_body"
echo "  Time: $ts"
```

### assign

```bash
[ -z "$assignee_id" ] && { echo "ERROR: --assignee-id required."; exit 1; }

# Validate agent exists in org
exists=$(jq --arg id "$assignee_id" '[.roles[] | select(.id == $id)] | length' "$orgFile")
[ "$exists" -eq 0 ] && echo "WARNING: Agent '$assignee_id' not found in org '$org_name'. Assigning anyway."

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${issuesFile}.tmp"
jq --arg id "$resolvedId" --arg ag "$assignee_id" --arg ts "$ts" \
  '.issues = [.issues[] | if .id == $id then .assignee_id = $ag | .updated_at = $ts else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"

echo "Issue '$issue_id' assigned to '$assignee_id'."
```

### close

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${issuesFile}.tmp"
jq --arg id "$resolvedId" --arg ts "$ts" \
  '.issues = [.issues[] | if .id == $id then .status = "done" | .updated_at = $ts | .closed_at = $ts else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"
echo "Issue '$issue_id' → done (closed at $ts)."
```

### reopen

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${issuesFile}.tmp"
jq --arg id "$resolvedId" --arg ts "$ts" \
  '.issues = [.issues[] | if .id == $id then .status = "open" | .updated_at = $ts | .closed_at = null else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"
echo "Issue '$issue_id' → reopened."
```

### recover

```bash
[ -z "$recovery_action" ] && { echo "ERROR: --recovery-action required (accept|reject)."; exit 1; }
case "$recovery_action" in accept|reject) : ;; *)
  echo "ERROR: --recovery-action must be 'accept' or 'reject'."; exit 1 ;;
esac

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
newStatus=$([ "$recovery_action" = "accept" ] && echo "in_progress" || echo "cancelled")

tmp="${issuesFile}.tmp"
jq --arg id "$resolvedId" --arg st "$newStatus" --arg ts "$ts" --arg ra "$recovery_action" \
  '.issues = [.issues[] | if .id == $id then
     .status = $st | .recovery_status = $ra | .updated_at = $ts
   else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"

echo "Recovery action '$recovery_action' applied to '$issue_id'."
echo "  New status: $newStatus"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
issue_id: <issue_id>
issue_status: <status>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
