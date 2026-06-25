---
name: mastermind-access
description: Mastermind access — manage org membership roles (owner/admin/operator/viewer), granular permission grants, invite tokens, and pending join requests. Controls who can do what inside an org.
type: domain-skill
default_mode: confirm
---

# Mastermind Access

This skill is invoked by `mastermind:access` or directly via `/mastermind:access`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage access for (required)
- `action`: list | invite | set-role | grant | revoke | remove | suspend | join-requests | approve-join | reject-join
- `member_id`: member slug/id (required for set-role/grant/revoke/remove/suspend)
- `role`: owner | admin | operator | viewer (required for invite/set-role)
- `permission`: permission key to grant/revoke (see Permission Keys below)
- `request_id`: join request id (required for approve-join/reject-join)
- `caller`: command | master

---

## Permission Keys

| Key | Label | Implied by role |
|-----|-------|-----------------|
| `agents:create` | Create agents | owner, admin |
| `users:invite` | Invite members | owner, admin |
| `users:manage_permissions` | Manage members | owner |
| `tasks:assign` | Assign tasks | owner, admin, operator |
| `tasks:assign_scope` | Assign scoped tasks | — (explicit only) |
| `tasks:manage_active_checkouts` | Manage active checkouts | — (explicit only) |
| `joins:approve` | Approve join requests | owner, admin |
| `environments:manage` | Manage environments | owner, admin |

**Role implied grants:**
- `owner` → all permissions
- `admin` → agents:create, users:invite, tasks:assign, joins:approve, environments:manage
- `operator` → tasks:assign
- `viewer` → (none)

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Members File

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

membersFile=".monomind/orgs/${org_name}-members.json"
[ ! -f "$membersFile" ] && cat > "$membersFile" <<'EOF'
{"members":[],"join_requests":[]}
EOF
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "MEMBERS — org: $org_name"
echo "────────────────────────────────────────────────────────"
printf "%-20s %-10s %-12s %s\n" "ID" "ROLE" "STATUS" "EXPLICIT GRANTS"
echo "────────────────────────────────────────────────────────"

count=$(jq '.members | length' "$membersFile")
if [ "$count" -eq 0 ]; then
  echo "  No members. Use --action invite to add the first member."
else
  jq -r '(.members // [])[] |
    [.id, (.role // "viewer"), (.status // "active"),
     ((.grants // []) | join(", ") | if . == "" then "(none)" else . end)]
    | @tsv' "$membersFile" | while IFS=$'\t' read -r id role status grants; do
    printf "%-20s %-10s %-12s %s\n" "$id" "$role" "$status" "$grants"
  done
fi

# Show pending join requests
pending=$(jq '[(.join_requests // [])[] | select(.status == "pending")] | length' "$membersFile")
[ "$pending" -gt 0 ] && echo "" && echo "  ⚠ $pending pending join request(s). Run --action join-requests to review."
```

### invite

Generate an invite token for a new member:

```bash
[ -z "$role" ] && role="operator"
case "$role" in owner|admin|operator|viewer) : ;; *)
  echo "ERROR: --role must be one of: owner, admin, operator, viewer"; exit 1 ;;
esac

inviteToken=$(openssl rand -hex 16 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(16))")
inviteUrl="https://monomind.local/invite?org=${org_name}&token=${inviteToken}&role=${role}"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

tmp="${membersFile}.tmp"
jq --arg token "$inviteToken" --arg role "$role" --arg ts "$ts" --arg url "$inviteUrl" \
  '.join_requests += [{"id":$token,"type":"invite","role":$role,"status":"pending","token":$token,"inviteUrl":$url,"createdAt":$ts}]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"

echo "INVITE CREATED"
echo "  Role:  $role"
echo "  Token: $inviteToken"
echo "  URL:   $inviteUrl"
echo ""
echo "Share this URL or token with the new member."
```

### set-role

```bash
[ -z "$member_id" ] && { echo "ERROR: --member-id required."; exit 1; }
[ -z "$role" ] && { echo "ERROR: --role required."; exit 1; }
case "$role" in owner|admin|operator|viewer) : ;; *)
  echo "ERROR: --role must be one of: owner, admin, operator, viewer"; exit 1 ;;
esac

tmp="${membersFile}.tmp"
jq --arg id "$member_id" --arg role "$role" \
  '.members = [(.members // [])[] | if .id == $id then .role = $role else . end]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"
echo "Member '$member_id' role → $role"
```

### grant / revoke

```bash
[ -z "$member_id" ] && { echo "ERROR: --member-id required."; exit 1; }
[ -z "$permission" ] && { echo "ERROR: --permission required (e.g. agents:create)."; exit 1; }

validKeys="agents:create users:invite users:manage_permissions tasks:assign tasks:assign_scope tasks:manage_active_checkouts joins:approve environments:manage"
echo "$validKeys" | grep -qw "$permission" || { echo "ERROR: Unknown permission '$permission'."; exit 1; }

tmp="${membersFile}.tmp"
if [ "$action" = "grant" ]; then
  jq --arg id "$member_id" --arg perm "$permission" \
    '.members = [(.members // [])[] | if .id == $id then .grants = ((.grants // []) + [$perm] | unique) else . end]' \
    "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"
  echo "Granted: $permission → $member_id"
else
  jq --arg id "$member_id" --arg perm "$permission" \
    '.members = [(.members // [])[] | if .id == $id then .grants = ((.grants // []) | map(select(. != $perm))) else . end]' \
    "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"
  echo "Revoked: $permission from $member_id"
fi
```

### remove

```bash
[ -z "$member_id" ] && { echo "ERROR: --member-id required."; exit 1; }
tmp="${membersFile}.tmp"
jq --arg id "$member_id" '.members = [(.members // [])[] | select(.id != $id)]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"
echo "Removed member: $member_id"
```

### suspend

```bash
[ -z "$member_id" ] && { echo "ERROR: --member-id required."; exit 1; }
tmp="${membersFile}.tmp"
jq --arg id "$member_id" \
  '.members = [(.members // [])[] | if .id == $id then .status = "suspended" else . end]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"
echo "Member '$member_id' suspended. They cannot perform org actions until reinstated."
```

### join-requests

List pending join requests:

```bash
echo "JOIN REQUESTS — org: $org_name"
echo "────────────────────────────────────────────────────────"
jq -r '(.join_requests // [])[] | select(.status == "pending") |
  "[\(.id)] type=\(.type // "join")  role=\(.role // "viewer")  created=\(.createdAt // "?")
   → /mastermind:access --org '"$org_name"' --action approve-join --request-id \(.id)
   → /mastermind:access --org '"$org_name"' --action reject-join  --request-id \(.id)"
' "$membersFile" 2>/dev/null || echo "  No pending join requests."
```

### approve-join / reject-join

```bash
[ -z "$request_id" ] && { echo "ERROR: --request-id required."; exit 1; }
newStatus=$([ "$action" = "approve-join" ] && echo "approved" || echo "rejected")

tmp="${membersFile}.tmp"
if [ "$action" = "approve-join" ]; then
  # Get role from request, create member record
  requestRole=$(jq -r --arg id "$request_id" '(.join_requests // [])[] | select(.id == $id) | .role // "viewer"' "$membersFile")
  jq --arg id "$request_id" --arg status "$newStatus" --arg role "$requestRole" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.join_requests = [(.join_requests // [])[] | if .id == $id then .status = $status | .resolvedAt = $ts else . end] |
     .members += [{"id":$id,"role":$role,"status":"active","grants":[],"joinedAt":$ts}]' \
    "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"
  echo "Approved join request $request_id (role: $requestRole). Member added."
else
  jq --arg id "$request_id" --arg status "$newStatus" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.join_requests = [(.join_requests // [])[] | if .id == $id then .status = $status | .resolvedAt = $ts else . end]' \
    "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"
  echo "Rejected join request $request_id."
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
members_count: <N>
pending_requests: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
