---
name: mastermind-my-issues
description: Mastermind my-issues — filtered issue queue scoped to the current operator or a specific assignee. Lists open and in-progress issues, supports self-assign and unassign. Mirrors MyIssues.tsx.
type: domain-skill
default_mode: auto
---

# Mastermind My Issues

This skill is invoked by `mastermind:my-issues` or directly via `/mastermind:my-issues`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to query issues from (required)
- `action`: list | assign-self | unassign | close
- `assignee_id`: user/agent id to filter by (default: local-operator)
- `issue_id`: issue id (required for assign-self / unassign / close)
- `status_filter`: open | in_progress | all (default: open+in_progress)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Issues

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

issuesFile=".monomind/orgs/${org_name}-issues.json"
[ ! -f "$issuesFile" ] && { echo "No issues found for org '${org_name}'."; exit 0; }

assigneeFilter="${assignee_id:-local-operator}"
```

---

## Step 2 — Execute Action

### list (default)

```bash
statusFilter="${status_filter:-active}"
echo "MY ISSUES — org: $org_name  assignee: $assigneeFilter"
echo "────────────────────────────────────────────────────────"
printf "%-24s %-12s %-10s %s\n" "ID" "STATUS" "PRIORITY" "TITLE"
echo "────────────────────────────────────────────────────────"

jq -r --arg uid "$assigneeFilter" --arg sf "$statusFilter" '
  (.issues // [])[] |
  select(
    (.assigneeId == $uid or .assigned_to == $uid) and
    (if $sf == "active" then (.status == "open" or .status == "in_progress")
     elif $sf == "all" then true
     else .status == $sf
     end)
  ) |
  [.id, (.status // "open"), (.priority // "medium"), (.title // "(no title)")] | @tsv
' "$issuesFile" | while IFS=$'\t' read -r id st pri title; do
  printf "%-24s %-12s %-10s %s\n" "$id" "$st" "$pri" "$title"
done

total=$(jq -r --arg uid "$assigneeFilter" \
  '[(.issues // [])[] | select(.assigneeId == $uid or .assigned_to == $uid)] | length' \
  "$issuesFile")
echo ""
echo "Total assigned: $total"
[ "$total" -eq 0 ] && echo "  No issues assigned to '$assigneeFilter'. To assign: --action assign-self --issue-id <id>"
```

### assign-self

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }

exists=$(jq -r --arg id "$issue_id" '[(.issues // [])[] | select(.id == $id)] | length' "$issuesFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Issue '$issue_id' not found."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${issuesFile}.tmp"
jq --arg id "$issue_id" --arg uid "$assigneeFilter" --arg ts "$ts" \
  '.issues = [(.issues // [])[] | if .id == $id then
     .assigneeId = $uid | .lastActivityAt = $ts
   else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"

echo "Issue '$issue_id' assigned to '$assigneeFilter'."
```

### unassign

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${issuesFile}.tmp"
jq --arg id "$issue_id" --arg ts "$ts" \
  '.issues = [(.issues // [])[] | if .id == $id then
     .assigneeId = null | .lastActivityAt = $ts
   else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"

echo "Issue '$issue_id' unassigned."
```

### close

```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${issuesFile}.tmp"
jq --arg id "$issue_id" --arg ts "$ts" \
  '.issues = [(.issues // [])[] | if .id == $id then
     .status = "done" | .closedAt = $ts | .lastActivityAt = $ts
   else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"

echo "Issue '$issue_id' closed (status: done)."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
assignee: <assignee_id>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
