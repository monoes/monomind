---
name: mastermind-profile
description: Mastermind profile — view and edit the current operator profile (display name, preferences) and inspect any user's activity statistics, completion rate, and token usage. Merges ProfileSettings.tsx and UserProfile.tsx.
type: domain-skill
default_mode: confirm
---

# Mastermind Profile

This skill is invoked by `mastermind:profile` or directly via `/mastermind:profile`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: show | edit | view-user | stats
- `user_id`: user id to view (for view-user/stats; defaults to current operator)
- `org_name`: org context for per-org stats (optional)
- `display_name`: new display name (for edit)
- `email`: new email (for edit)
- `theme`: light | dark | system (for edit)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Profile File

```bash
profileFile=".monomind/operator-profile.json"
[ ! -f "$profileFile" ] && cat > "$profileFile" <<'EOF'
{
  "id": "local-operator",
  "displayName": "Operator",
  "email": "",
  "theme": "system",
  "avatarInitials": "OP",
  "keyboardShortcutsEnabled": true,
  "createdAt": null
}
EOF
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "OPERATOR PROFILE"
echo "────────────────────────────────────────────────────────"
jq -r '
  "  ID:            \(.id // "local-operator")",
  "  Display name:  \(.displayName // "(not set)")",
  "  Email:         \(.email // "(not set)")",
  "  Theme:         \(.theme // "system")",
  "  Initials:      \(.avatarInitials // "OP")",
  "  Shortcuts:     \(.keyboardShortcutsEnabled // true)",
  "  Created:       \(.createdAt // "(local)")"
' "$profileFile"

echo ""
echo "  To edit: --action edit --display-name 'New Name'"
echo "  To view stats: --action stats"
```

### edit

```bash
if [ -z "$display_name" ] && [ -z "$email" ] && [ -z "$theme" ]; then
  echo "ERROR: Provide at least one of: --display-name, --email, --theme (light|dark|system)"
  exit 1
fi

case "${theme:-}" in
  light|dark|system|"") : ;;
  *) echo "ERROR: --theme must be light, dark, or system"; exit 1 ;;
esac

tmp="${profileFile}.tmp"
jq \
  --arg name "${display_name:-}" \
  --arg email "${email:-}" \
  --arg theme "${theme:-}" \
  '(if $name != "" then .displayName = $name else . end) |
   (if $email != "" then .email = $email else . end) |
   (if $theme != "" then .theme = $theme else . end) |
   (if $name != "" then .avatarInitials = ($name | split(" ") |
     map(select(length > 0) | .[0:1] | ascii_upcase) | .[0:2] | join(""))
   else . end)' \
  "$profileFile" > "$tmp" && mv "$tmp" "$profileFile"

echo "Profile updated."
jq -r '"  displayName: \(.displayName)  email: \(.email)  theme: \(.theme)"' "$profileFile"
```

### view-user

```bash
targetId="${user_id:-local-operator}"
echo "USER PROFILE — $targetId"
echo "────────────────────────────────────────────────────────"

# Try to find in instance access file
accessFile=".monomind/instance-access.json"
if [ -f "$accessFile" ]; then
  userEntry=$(jq -r --arg id "$targetId" '.users[] | select(.id == $id)' "$accessFile")
  if [ -n "$userEntry" ]; then
    isAdmin=$(echo "$userEntry" | jq -r '.isInstanceAdmin // false')
    orgs=$(echo "$userEntry" | jq -r '(.companyAccess // []) | join(", ")')
    echo "  ID:              $targetId"
    echo "  Instance admin:  $isAdmin"
    echo "  Org access:      ${orgs:-(none)}"
  else
    echo "  ID: $targetId"
    echo "  (User not found in instance access registry)"
  fi
else
  echo "  ID: $targetId  (no instance access file)"
fi

echo ""
echo "  For activity stats: --action stats --user-id $targetId"
```

### stats

```bash
targetId="${user_id:-local-operator}"
echo "ACTIVITY STATS — $targetId"
echo "────────────────────────────────────────────────────────"

# Scan activity files for user contributions
totalRuns=0; successRuns=0; totalInputTokens=0; totalOutputTokens=0

for actFile in data/mastermind-sessions.json .monomind/orgs/*-activity.jsonl; do
  [ -f "$actFile" ] || continue
  if echo "$actFile" | grep -q "\.jsonl$"; then
    cnt=$(grep -c "\"actorId\":\"${targetId}\"" "$actFile" 2>/dev/null || echo 0)
    succ=$(grep "\"actorId\":\"${targetId}\"" "$actFile" 2>/dev/null | grep -c '"outcome":"success"' || echo 0)
    totalRuns=$((totalRuns + cnt))
    successRuns=$((successRuns + succ))
  fi
done

# Per-org if org_name set
if [ -n "$org_name" ]; then
  issuesFile=".monomind/orgs/${org_name}-issues.json"
  if [ -f "$issuesFile" ]; then
    assigned=$(jq --arg uid "$targetId" '[.issues[] | select(.assigneeId == $uid)] | length' "$issuesFile")
    echo "  Issues assigned (org $org_name): $assigned"
  fi
fi

completionRate=0
[ "$totalRuns" -gt 0 ] && completionRate=$((successRuns * 100 / totalRuns))

echo "  Total runs tracked:   $totalRuns"
echo "  Successful runs:      $successRuns"
echo "  Completion rate:      ${completionRate}%"
echo ""
echo "  (Token usage stats require agent run logs with token tracking enabled)"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
user_id: <user_id or local-operator>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
