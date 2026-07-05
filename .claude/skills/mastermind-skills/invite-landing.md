---
name: mastermind-invite-landing
description: Mastermind invite-landing — accept an org invite as a human member or as an agent. Validates the invite token, presents org/role info, and processes join as human (name/email) or as an agent (adapter type, model, agent name, config). Mirrors InviteLanding.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Invite Landing

This skill is invoked by `mastermind:invite-landing` or directly via `/mastermind:invite-landing`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: show | accept-human | accept-agent | status
- `token`: invite token (required; extract from monomind://invite?... URL or share link)
- `org_name`: org name (required unless extractable from token record)
- `join_as`: human | agent (for accept actions; default: agent in CLI context)
- `display_name`: human display name (for accept-human)
- `email`: email address (for accept-human)
- `agent_name`: agent display name (for accept-agent)
- `adapter_type`: claude-local | gemini-local | codex-local | cursor | opencode | hermes | http | acpx (for accept-agent; default: claude-local)
- `model`: model override (for accept-agent; uses adapter default if omitted)
- `caller`: command | master

---

## Join Modes

| Mode | Who | Required Fields |
|------|-----|-----------------|
| `human` | A human operator joining the org | `display_name`, `email` |
| `agent` | An AI agent joining the org | `agent_name`, `adapter_type` |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Validate Token

```bash
[ -z "$token" ] && { echo "ERROR: --token required. Extract from invite URL: monomind://invite?org=...&token=...&role=..."; exit 1; }

# Try to find org from token if org_name not given
if [ -z "$org_name" ]; then
  # Search all members files for a matching invite token
  for mf in .monomind/orgs/*-members.json; do
    [ -f "$mf" ] || continue
    match=$(jq -r --arg t "$token" '(.join_requests // [])[] | select(.token == $t or .id == $t) | .id' "$mf" 2>/dev/null | head -1)
    if [ -n "$match" ]; then
      org_name=$(basename "$mf" "-members.json")
      break
    fi
  done
  [ -z "$org_name" ] && { echo "ERROR: Could not find org for token '$token'. Specify --org-name explicitly."; exit 1; }
fi

membersFile=".monomind/orgs/${org_name}-members.json"
[ ! -f "$membersFile" ] && { echo "ERROR: Org '$org_name' members file not found."; exit 1; }

inviteDef=$(jq -r --arg t "$token" \
  '(.join_requests // [])[] | select((.token == $t or .id == $t) and .type == "invite")' \
  "$membersFile" | head -c 4096)
[ -z "$inviteDef" ] && { echo "ERROR: Invite token '$token' not found or already used."; exit 1; }

inviteStatus=$(echo "$inviteDef" | jq -r '.status // "pending"')
inviteRole=$(echo "$inviteDef" | jq -r '.role // "operator"')
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "INVITE — org: $org_name"
echo "────────────────────────────────────────────────────────"
echo "  Token:    ${token:0:16}…"
echo "  Role:     $inviteRole"
echo "  Status:   $inviteStatus"

inviteCreatedAt=$(echo "$inviteDef" | jq -r '.createdAt // "-"')
echo "  Created:  $inviteCreatedAt"
echo ""

if [ "$inviteStatus" = "revoked" ]; then
  echo "  This invite has been revoked and can no longer be used."
elif [ "$inviteStatus" = "accepted" ]; then
  echo "  This invite has already been accepted."
else
  echo "  To join as an agent (default in CLI):"
  echo "    --action accept-agent --token $token --org-name $org_name --agent-name 'My Agent' --adapter-type claude-local"
  echo ""
  echo "  To join as a human:"
  echo "    --action accept-human --token $token --org-name $org_name --display-name 'Your Name' --email 'you@example.com'"
fi
```

### accept-human

```bash
[ "$inviteStatus" != "pending" ] && { echo "ERROR: Invite status is '$inviteStatus' — cannot accept."; exit 1; }
[ -z "$display_name" ] && { echo "ERROR: --display-name required for human join."; exit 1; }
[ -z "$email" ] && { echo "ERROR: --email required for human join."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
memberId="human-$(echo "${email}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')"

tmp="${membersFile}.tmp"
# Mark invite accepted and add member record
jq --arg token "$token" --arg mid "$memberId" --arg name "$display_name" \
   --arg email "$email" --arg role "$inviteRole" --arg ts "$ts" \
  '.join_requests = [(.join_requests // [])[] | if (.token == $token or .id == $token) then
     .status = "accepted" | .acceptedAt = $ts | .acceptedAs = "human"
   else . end] |
   .members += [{"id":$mid,"displayName":$name,"email":$email,"role":$role,
     "memberType":"human","status":"active","joinedAt":$ts}]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"

echo "JOINED as human: $display_name"
echo "  Member ID:  $memberId"
echo "  Role:       $inviteRole"
echo "  Org:        $org_name"
echo "  Email:      $email"
echo "  Joined at:  $ts"
```

### accept-agent

```bash
[ "$inviteStatus" != "pending" ] && { echo "ERROR: Invite status is '$inviteStatus' — cannot accept."; exit 1; }
[ -z "$agent_name" ] && { echo "ERROR: --agent-name required for agent join."; exit 1; }

adapterType="${adapter_type:-claude-local}"
case "$adapterType" in
  claude-local|gemini-local|codex-local|cursor|opencode-local|hermes-local|http|acpx) : ;;
  *) echo "ERROR: Unknown adapter type '$adapterType'. Choose: claude-local, gemini-local, codex-local, cursor, opencode-local, hermes-local, http, acpx"; exit 1 ;;
esac

# Resolve default model
modelId="${model}"
if [ -z "$modelId" ]; then
  case "$adapterType" in
    claude-local)   modelId="claude-sonnet-4-6" ;;
    gemini-local)   modelId="gemini-2.0-flash" ;;
    codex-local)    modelId="gpt-4o" ;;
    cursor)         modelId="cursor-default" ;;
    opencode-local) modelId="opencode-default" ;;
    hermes-local)   modelId="hermes-3" ;;
    *)              modelId="custom" ;;
  esac
fi

# Generate agent slug
agentSlug=$(echo "$agent_name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//')
agentId="agent-${agentSlug}"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Add to members file
tmp="${membersFile}.tmp"
jq --arg token "$token" --arg mid "$agentId" --arg name "$agent_name" \
   --arg role "$inviteRole" --arg adapter "$adapterType" --arg model "$modelId" --arg ts "$ts" \
  '.join_requests = [(.join_requests // [])[] | if (.token == $token or .id == $token) then
     .status = "accepted" | .acceptedAt = $ts | .acceptedAs = "agent"
   else . end] |
   .members += [{"id":$mid,"displayName":$name,"role":$role,
     "memberType":"agent","adapter":{"type":$adapter,"model":$model},
     "status":"active","joinedAt":$ts}]' \
  "$membersFile" > "$tmp" && mv "$tmp" "$membersFile"

# Also add to org roles file so the agent can run
orgFile=".monomind/orgs/${org_name}.json"
if [ -f "$orgFile" ]; then
  dupCheck=$(jq -r --arg id "$agentId" '[(.roles // [])[] | select(.id == $id)] | length' "$orgFile")
  if [ "$dupCheck" -eq 0 ]; then
    tmp2="${orgFile}.tmp"
    jq --arg id "$agentId" --arg title "$agent_name" \
       --arg adapter "$adapterType" --arg model "$modelId" --arg ts "$ts" \
      '.roles += [{"id":$id,"title":$title,"adapter":{"type":$adapter,"model":$model,"max_tokens":8192},
        "reports_to":null,"governance":null,"skills":[],"created_at":$ts}]' \
      "$orgFile" > "$tmp2" && mv "$tmp2" "$orgFile"
  fi
fi

echo "JOINED as agent: $agent_name"
echo "  Agent ID:    $agentId"
echo "  Role:        $inviteRole"
echo "  Adapter:     $adapterType / $modelId"
echo "  Org:         $org_name"
echo "  Joined at:   $ts"
echo ""
echo "  View agent: /mastermind:agent-detail --org $org_name --agent-id $agentId"
```

### status

```bash
echo "INVITE STATUS — token: ${token:0:16}…"
echo "────────────────────────────────────────────────────────"
echo "$inviteDef" | jq '{status, role, createdAt, acceptedAt, acceptedAs}'
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
invite_status: <status>
role: <role>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
