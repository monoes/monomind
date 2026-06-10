---
name: mastermind-invites
description: Mastermind invites — manage org invitations and join request queue. Create/revoke invites with role assignment, view invite history, review pending join requests (human and agent), and approve or reject them. Merges CompanyInvites and JoinRequestQueue pages.
type: domain-skill
default_mode: confirm
---

# Mastermind Invites

This skill is invoked by `mastermind:invites` or directly via `/mastermind:invites`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage invites for (required)
- `action`: list | create | revoke | copy-url | join-queue | approve-join | reject-join
- `role`: owner | admin | operator | viewer (for create; default: operator)
- `invite_id`: invite id/token (for revoke/copy-url)
- `request_id`: join request id (for approve-join/reject-join)
- `request_type`: all | human | agent (for join-queue; default: all)
- `status_filter`: pending_approval | approved | rejected (for join-queue; default: pending_approval)
- `caller`: command | master

---

## Invite Roles

| Role | Can Do |
|------|--------|
| `owner` | Full control — all permissions |
| `admin` | Create agents, invite users, assign tasks, approve joins, manage environments |
| `operator` | Assign tasks, run routines |
| `viewer` | Read-only access |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Members File

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

membersFile=".monomind/orgs/${org_name}-members.json"
[ ! -f "$membersFile" ] && echo '{"members":[],"join_requests":[]}' > "$membersFile"
```

---

## Step 2 — Execute Action

### list (default)

Show invite history and member count:

```bash
echo "INVITES — org: $org_name"
echo "────────────────────────────────────────────────────────"

# Active invites (pending in join_requests with type=invite)
activeInvites=$(jq '[(.join_requests // [])[] | select(.type == "invite" and .status == "pending")] | length' "$membersFile")
totalMembers=$(jq '.members | length' "$membersFile")
pendingJoins=$(jq '[(.join_requests // [])[] | select(.type != "invite" and .status == "pending_approval")] | length' "$membersFile")

echo "  Members:          $totalMembers"
echo "  Pending invites:  $activeInvites"
echo "  Pending joins:    $pendingJoins"
echo ""

if [ "$activeInvites" -gt 0 ]; then
  echo "ACTIVE INVITES"
  printf "  %-28s %-10s %-20s %s\n" "TOKEN" "ROLE" "CREATED" "URL"
  echo "  ────────────────────────────────────────────────────────"
  jq -r '(.join_requests // [])[] | select(.type == "invite" and .status == "pending") |
    [.token, (.role // "operator"), (.createdAt // "-"), (.inviteUrl // "-")] | @tsv' \
    "$membersFile" | while IFS=$'\t' read -r tok role ts url; do
    printf "  %-28s %-10s %-20s %s\n" "${tok:0:24}…" "$role" "$ts" "${url:0:40}…"
  done
fi

echo ""
echo "  To create a new invite: --action create --role <role>"
[ "$pendingJoins" -gt 0 ] && echo "  To review join requests: --action join-queue"
```

### create

```bash
role="${role:-operator}"
case "$role" in owner|admin|operator|viewer) : ;; *)
  echo "ERROR: --role must be: owner, admin, operator, viewer"; exit 1 ;;
esac

token=$(openssl rand -hex 20 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(20))")
inviteUrl="monomind://invite?org=${org_name}&token=${token}&role=${role}"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${membersFile}.tmp"
jq --arg token "$token" --arg role "$role" --arg ts "$ts" --arg url "$inviteUrl" \
  '.join_requests += [{"id":$token,"type":"invite","role":$role,"status":"pending",
    "token":$token,"inviteUrl":$url,"createdAt":$ts}]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"

echo "INVITE CREATED"
echo "────────────────────────────────────────────────────────"
echo "  Role:  $role"
echo "  Token: $token"
echo "  URL:   $inviteUrl"
echo "  Time:  $ts"
echo ""
echo "Share the token or URL with the invitee."
echo "To copy URL hint: --action copy-url --invite-id $token"
```

### revoke

```bash
[ -z "$invite_id" ] && { echo "ERROR: --invite-id required."; exit 1; }

# Find the invite
inviteExists=$(jq -r --arg id "$invite_id" \
  '[(.join_requests // [])[] | select((.id == $id or .token == $id) and .type == "invite")] | length' \
  "$membersFile")
[ "$inviteExists" -eq 0 ] && { echo "ERROR: Invite '$invite_id' not found or already resolved."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${membersFile}.tmp"
jq --arg id "$invite_id" --arg ts "$ts" \
  '.join_requests = [(.join_requests // [])[] | if (.id == $id or .token == $id) then
     .status = "revoked" | .resolvedAt = $ts
   else . end]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"

echo "Invite revoked: $invite_id"
echo "  Revoked at: $ts"
```

### copy-url

```bash
[ -z "$invite_id" ] && { echo "ERROR: --invite-id required."; exit 1; }

inviteUrl=$(jq -r --arg id "$invite_id" \
  '(.join_requests // [])[] | select(.id == $id or .token == $id) | .inviteUrl // ""' \
  "$membersFile")
[ -z "$inviteUrl" ] && { echo "ERROR: Invite '$invite_id' not found."; exit 1; }

echo "INVITE URL"
echo "────────────────────────────────────────────────────────"
echo "$inviteUrl"
echo ""
echo "(Copy the URL above to share with the invitee)"
# Try to copy to clipboard if pbcopy/xclip available
echo "$inviteUrl" | pbcopy 2>/dev/null && echo "(Copied to clipboard)" || true
```

### join-queue

```bash
statusFilter="${status_filter:-pending_approval}"
typeFilter="${request_type:-all}"

echo "JOIN REQUEST QUEUE — org: $org_name"
echo "  Filter: status=$statusFilter  type=$typeFilter"
echo "────────────────────────────────────────────────────────"

jq -r --arg st "$statusFilter" --arg type "$typeFilter" '
  (.join_requests // [])[] |
  select(
    (.status == $st) and
    (.type != "invite") and
    (if $type == "all" then true
     elif $type == "human" then (.requestType == "human" or .requestType == null)
     else .requestType == "agent"
     end)
  ) |
  [.id, (.requestType // "human"), (.role // "viewer"), (.createdAt // "-"), (.message // "(no message)")] | @tsv
' "$membersFile" | while IFS=$'\t' read -r id rtype role ts msg; do
  echo ""
  echo "  [$id]  type=$rtype  role=$role  at=$ts"
  echo "  Message: $msg"
  echo "  → approve: --action approve-join --request-id $id"
  echo "  → reject:  --action reject-join  --request-id $id"
done

total=$(jq --arg st "$statusFilter" '[(.join_requests // [])[] | select(.status == $st and .type != "invite")] | length' "$membersFile")
[ "$total" -eq 0 ] && echo "  No join requests with status='$statusFilter'."
echo ""
echo "Total ($statusFilter): $total"
```

### approve-join

```bash
[ -z "$request_id" ] && { echo "ERROR: --request-id required."; exit 1; }

reqRole=$(jq -r --arg id "$request_id" \
  '(.join_requests // [])[] | select(.id == $id) | .role // "viewer"' "$membersFile")
[ -z "$reqRole" ] && { echo "ERROR: Request '$request_id' not found."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${membersFile}.tmp"
jq --arg id "$request_id" --arg role "$reqRole" --arg ts "$ts" \
  '.join_requests = [(.join_requests // [])[] | if .id == $id then .status = "approved" | .resolvedAt = $ts else . end] |
   .members += [{"id":$id,"role":$role,"status":"active","grants":[],"joinedAt":$ts}]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"

echo "Join request '$request_id' approved."
echo "  Role: $reqRole  |  Joined: $ts"
echo "  Member added. View members: /mastermind:access --org $org_name --action list"
```

### reject-join

```bash
[ -z "$request_id" ] && { echo "ERROR: --request-id required."; exit 1; }

exists=$(jq -r --arg id "$request_id" '[(.join_requests // [])[] | select(.id == $id)] | length' "$membersFile")
[ "$exists" -eq 0 ] && { echo "ERROR: Request '$request_id' not found."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${membersFile}.tmp"
jq --arg id "$request_id" --arg ts "$ts" \
  '.join_requests = [(.join_requests // [])[] | if .id == $id then .status = "rejected" | .resolvedAt = $ts else . end]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"

echo "Join request '$request_id' rejected."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
pending_invites: <N>
pending_joins: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
