---
name: mastermind-approve
description: Mastermind approve — review and action pending approval requests from agents in a running org. Agents can request human approval before proceeding with sensitive actions.
type: domain-skill
default_mode: confirm
---

# Mastermind Approve

This skill is invoked by `mastermind:approve` or directly via `/mastermind:approve`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org to check approvals for
- `action`: list | approve | reject | inspect
- `approval_id`: id of the specific approval request (for approve/reject/inspect)
- `reason`: optional reason for rejection
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Approvals

Approvals are stored in `.monomind/orgs/<org_name>-approvals.json`:

```bash
orgFile=".monomind/orgs/${org_name}.json"
approvalsFile=".monomind/orgs/${org_name}-approvals.json"
[ ! -f "$approvalsFile" ] && echo '{"approvals":[]}' > "$approvalsFile"
```

---

## Step 2 — Execute Action

### list (default)

Show pending approval requests from agents:

```bash
jq -r '
  .approvals | map(select(.status == "pending")) |
  if length == 0 then "No pending approvals." else
    .[] | "[\(.id)] \(.agent_id): \(.title)\n  Action: \(.action)\n  Risk: \(.risk_level // "low")\n  Requested: \(.requested_at)"
  end
' "$approvalsFile"
```

Render as:
```
PENDING APPROVALS — org: <org_name>
──────────────────────────────────────────────────
[req-001] content-writer: Publish to external blog
  Action: POST to https://blog.example.com/api/posts
  Risk:   medium
  Requested: 2 min ago

[req-002] marketer: Send email campaign
  Action: Send to 1,200 subscribers
  Risk:   high  ← requires explicit approval
  Requested: 5 min ago
──────────────────────────────────────────────────
2 pending  |  Type "approve <id>" or "reject <id> <reason>"
```

### inspect

Show full details of a single approval request:

```bash
jq --arg id "$approval_id" '.approvals[] | select(.id == $id)' "$approvalsFile"
```

Print the agent's requested action, context, and any supporting evidence they provided.

### approve

Update approval status and notify the waiting agent via memory:

```bash
tmp="${approvalsFile}.tmp"
jq --arg id "$approval_id" \
   '.approvals = [.approvals[] | if .id == $id then .status = "approved" | .resolved_at = (now|todate) | .resolved_by = "human" else . end]' \
   "$approvalsFile" > "$tmp" && mv "$tmp" "$approvalsFile"

# Notify the agent via memory so it can proceed
approval=$(jq --arg id "$approval_id" '.approvals[] | select(.id == $id)' "$approvalsFile")
agent_id=$(echo "$approval" | jq -r '.agent_id')
memNs="org:${org_name}"
npx monomind@latest memory store \
  --key "approval:${approval_id}" \
  --namespace "$memNs" \
  --value '{"status":"approved","approval_id":"'"$approval_id"'","ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'

echo "Approved request $approval_id — agent $agent_id may proceed."
```

Emit `org:approval:approved` event to dashboard.

### reject

```bash
tmp="${approvalsFile}.tmp"
jq --arg id "$approval_id" --arg reason "${reason:-No reason given}" \
   '.approvals = [.approvals[] | if .id == $id then .status = "rejected" | .resolved_at = (now|todate) | .resolved_by = "human" | .rejection_reason = $reason else . end]' \
   "$approvalsFile" > "$tmp" && mv "$tmp" "$approvalsFile"

approval=$(jq --arg id "$approval_id" '.approvals[] | select(.id == $id)' "$approvalsFile")
agent_id=$(echo "$approval" | jq -r '.agent_id')
memNs="org:${org_name}"
npx monomind@latest memory store \
  --key "approval:${approval_id}" \
  --namespace "$memNs" \
  --value '{"status":"rejected","approval_id":"'"$approval_id"'","reason":"'"${reason:-No reason given}"'","ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'

echo "Rejected request $approval_id. Agent $agent_id has been notified."
```

Emit `org:approval:rejected` event.

---

## How Agents Request Approval

Agents that need human approval before a sensitive action should:

1. Write to the approvals file:
```bash
approvalsFile=".monomind/orgs/${orgName}-approvals.json"
[ ! -f "$approvalsFile" ] && echo '{"approvals":[]}' > "$approvalsFile"
approval_id="req-$(date +%s)"
tmp="${approvalsFile}.tmp"
jq --arg id "$approval_id" \
   --arg agent "$role_id" \
   --arg title "$action_title" \
   --arg action "$action_description" \
   --arg risk "medium" \
   '.approvals += [{"id":$id,"agent_id":$agent,"title":$title,"action":$action,"risk_level":$risk,"status":"pending","requested_at":(now|todate)}]' \
   "$approvalsFile" > "$tmp" && mv "$tmp" "$approvalsFile"
```

2. Emit `org:approval:requested` event to dashboard (so the human is notified).

3. Poll for the approval decision — check the approvals file first (authoritative, updated by both the dashboard UI and `/mastermind:approve`), then fall back to memory:
```bash
approvalsFile=".monomind/orgs/${orgName}-approvals.json"
while true; do
  # Check file first — dashboard approve/reject button only updates the file (not memory)
  file_status=$(jq --arg id "$approval_id" '.approvals[] | select(.id == $id) | .status // ""' "$approvalsFile" 2>/dev/null || echo "")
  if [ -z "$file_status" ] || [ "$file_status" = '"pending"' ] || [ "$file_status" = "pending" ]; then
    mem_result=$(npx monomind@latest memory search --query "approval:${approval_id}" --namespace "${memNs}" 2>/dev/null)
    mem_status=$(echo "$mem_result" | jq -r '.[0].value.status // ""' 2>/dev/null)
    [ -n "$mem_status" ] && [ "$mem_status" != "pending" ] && file_status="$mem_status"
  fi
  # Strip quotes from jq output
  file_status=$(echo "$file_status" | tr -d '"')
  [ "$file_status" = "approved" ] && break
  [ "$file_status" = "rejected" ] && { echo "Action rejected by governance policy — skip this action"; exit 1; }
  sleep 30
done
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
approval_id: <approval_id if applicable>
pending_count: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
