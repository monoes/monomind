---
name: mastermind-instance-settings
description: Mastermind instance-settings — instance-level administration covering general settings (auth, backup retention, keyboard shortcuts, AI feedback), experimental features (liveness auto-recovery), and user→company access grants. Extends mastermind:instance with InstanceGeneralSettings, InstanceExperimentalSettings, and InstanceAccess.
type: domain-skill
default_mode: confirm
---

# Mastermind Instance Settings

This skill is invoked by `mastermind:instance-settings` or directly via `/mastermind:instance-settings`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: show | general | experimental | access | set | toggle-liveness | preview-liveness | grant-access | revoke-access | set-admin | unset-admin
- `key`: general setting key to update (for `set` action)
- `value`: value to set (for `set` action)
- `user_id`: user id (for grant-access / revoke-access / set-admin / unset-admin)
- `org_name`: org name to grant/revoke access to (for grant-access / revoke-access)
- `search`: search query for user lookup (for access action)
- `caller`: command | master

---

## General Settings Keys

| Key | Type | Description |
|-----|------|-------------|
| `censorUsernameInLogs` | bool | Redact usernames from log output |
| `keyboardShortcutsEnabled` | bool | Enable keyboard shortcut navigation |
| `aiFeedbackSharingEnabled` | bool | Share feedback with AI provider |
| `dailyBackupRetentionDays` | int | Days to keep daily backups |
| `weeklyBackupRetentionWeeks` | int | Weeks to keep weekly backups |
| `monthlyBackupRetentionMonths` | int | Months to keep monthly backups |

## Experimental Settings

| Key | Type | Description |
|-----|------|-------------|
| `livenessAutoRecoveryEnabled` | bool | Auto-create recovery tasks for stalled issues |
| `livenessAutoRecoveryLookbackHours` | int | Hours to look back for stalled issues |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Instance Config

```bash
instanceFile=".monomind/instance.json"
[ ! -f "$instanceFile" ] && echo '{"general":{},"experimental":{},"access":{"users":[]}}' > "$instanceFile"
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "INSTANCE SETTINGS"
echo "────────────────────────────────────────────────────────"

general=$(jq -r '.general // {}' "$instanceFile")
exp=$(jq -r '.experimental // {}' "$instanceFile")

echo "GENERAL"
echo "  censorUsernameInLogs:          $(echo "$general" | jq -r '.censorUsernameInLogs // false')"
echo "  keyboardShortcutsEnabled:      $(echo "$general" | jq -r '.keyboardShortcutsEnabled // true')"
echo "  aiFeedbackSharingEnabled:      $(echo "$general" | jq -r '.aiFeedbackSharingEnabled // false')"
echo "  dailyBackupRetentionDays:      $(echo "$general" | jq -r '.dailyBackupRetentionDays // 7')"
echo "  weeklyBackupRetentionWeeks:    $(echo "$general" | jq -r '.weeklyBackupRetentionWeeks // 4')"
echo "  monthlyBackupRetentionMonths:  $(echo "$general" | jq -r '.monthlyBackupRetentionMonths // 12')"

echo ""
echo "EXPERIMENTAL"
echo "  livenessAutoRecoveryEnabled:         $(echo "$exp" | jq -r '.livenessAutoRecoveryEnabled // false')"
echo "  livenessAutoRecoveryLookbackHours:   $(echo "$exp" | jq -r '.livenessAutoRecoveryLookbackHours // 24')"

echo ""
echo "  To modify: --action set --key <key> --value <value>"
echo "  To view users: --action access"
```

### general

```bash
echo "GENERAL SETTINGS"
echo "────────────────────────────────────────────────────────"
jq -r '.general // {}' "$instanceFile" | jq .

echo ""
echo "BACKUP RETENTION PRESETS"
echo "  Daily:   7d / 14d / 30d / 60d / 90d"
echo "  Weekly:  4w / 8w / 12w / 26w / 52w"
echo "  Monthly: 3m / 6m / 12m / 24m"
```

### experimental

```bash
echo "EXPERIMENTAL SETTINGS"
echo "────────────────────────────────────────────────────────"
jq -r '.experimental // {}' "$instanceFile" | jq .

enabled=$(jq -r '.experimental.livenessAutoRecoveryEnabled // false' "$instanceFile")
hours=$(jq -r '.experimental.livenessAutoRecoveryLookbackHours // 24' "$instanceFile")

echo ""
echo "LIVENESS AUTO-RECOVERY"
echo "  Enabled:        $enabled"
echo "  Lookback hours: $hours"
echo ""
echo "  Toggle: --action toggle-liveness"
echo "  Preview: --action preview-liveness"
```

### set

```bash
[ -z "$key" ] && { echo "ERROR: --key required."; exit 1; }
[ -z "$value" ] && { echo "ERROR: --value required."; exit 1; }

# Determine target section
section="general"
case "$key" in
  livenessAutoRecovery*) section="experimental" ;;
esac

# Coerce booleans and integers
typedValue="$value"
case "$value" in
  true|false) typedValue=$(echo "$value") ;;
  *[0-9]*) echo "$value" | grep -qE '^[0-9]+$' && typedValue="$value" ;;
esac

tmp="${instanceFile}.tmp"
jq --arg section "$section" --arg k "$key" --argjson v "$(
  if echo "$typedValue" | grep -qE '^(true|false|[0-9]+)$'; then echo "$typedValue"; else echo "\"$typedValue\""; fi
)" \
  '.[$section][$k] = $v' \
  "$instanceFile" > "$tmp" && mv "$tmp" "$instanceFile"

echo "Instance setting updated: [$section] $key = $typedValue"
```

### toggle-liveness

```bash
current=$(jq -r '.experimental.livenessAutoRecoveryEnabled // false' "$instanceFile")
if [ "$current" = "true" ]; then
  newVal=false
else
  newVal=true
fi

tmp="${instanceFile}.tmp"
jq --argjson v "$newVal" '.experimental.livenessAutoRecoveryEnabled = $v' \
  "$instanceFile" > "$tmp" && mv "$tmp" "$instanceFile"

echo "Liveness auto-recovery toggled: $newVal"
```

### preview-liveness

```bash
hours=$(jq -r '.experimental.livenessAutoRecoveryLookbackHours // 24' "$instanceFile")
echo "LIVENESS AUTO-RECOVERY PREVIEW"
echo "  Lookback: last ${hours} hours"
echo "────────────────────────────────────────────────────────"
echo "  (Preview runs against live issue graph.)"
echo "  To enable: --action toggle-liveness"
echo ""
echo "  Checking activity files for stalled issues…"
cutoff=$(date -u -v-${hours}H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u --date="${hours} hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)

# Count potentially stalled issues across all orgs
stalledCount=0
for issuesFile in .monomind/orgs/*-issues.json; do
  [ -f "$issuesFile" ] || continue
  cnt=$(jq --arg cutoff "$cutoff" \
    '[.issues[] | select(.status == "in_progress" and (.lastActivityAt // .createdAt // "") < $cutoff)] | length' \
    "$issuesFile" 2>/dev/null || echo 0)
  stalledCount=$((stalledCount + cnt))
done

echo "  Potentially stalled issues (in_progress, no activity since cutoff): $stalledCount"
[ "$stalledCount" -gt 0 ] && echo "  Run --action toggle-liveness to enable auto-recovery."
```

### access

```bash
search="${search:-}"
accessFile=".monomind/instance-access.json"
[ ! -f "$accessFile" ] && echo '{"users":[]}' > "$accessFile"

echo "INSTANCE ACCESS — USER DIRECTORY"
echo "  Search: ${search:-(all)}"
echo "────────────────────────────────────────────────────────"
printf "%-32s %-20s %-10s %s\n" "USER ID" "NAME" "ADMIN" "COMPANIES"
echo "────────────────────────────────────────────────────────"

jq -r --arg q "$search" '.users[] |
  select($q == "" or (.id | ascii_downcase | contains($q | ascii_downcase))
    or (.name // "" | ascii_downcase | contains($q | ascii_downcase))) |
  [.id, (.name // "(unnamed)"), (if .isInstanceAdmin then "yes" else "no" end),
   ((.companyAccess // []) | length | tostring)] | @tsv' \
  "$accessFile" | while IFS=$'\t' read -r uid name admin count; do
  printf "%-32s %-20s %-10s %s orgs\n" "$uid" "$name" "$admin" "$count"
done

echo ""
echo "  Grant org access: --action grant-access --user-id <uid> --org-name <org>"
echo "  Revoke org access: --action revoke-access --user-id <uid> --org-name <org>"
echo "  Make instance admin: --action set-admin --user-id <uid>"
```

### grant-access

```bash
[ -z "$user_id" ] && { echo "ERROR: --user-id required."; exit 1; }
[ -z "$org_name" ] && { echo "ERROR: --org-name required."; exit 1; }

accessFile=".monomind/instance-access.json"
[ ! -f "$accessFile" ] && echo '{"users":[]}' > "$accessFile"

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp="${accessFile}.tmp"
jq --arg uid "$user_id" --arg org "$org_name" --arg ts "$ts" \
  '.users = (
    if any(.users[]; .id == $uid) then
      [.users[] | if .id == $uid then
        .companyAccess = ((.companyAccess // []) | if any(.[]; . == $org) then . else . + [$org] end)
      else . end]
    else
      .users + [{"id": $uid, "companyAccess": [$org], "isInstanceAdmin": false, "grantedAt": $ts}]
    end)' \
  "$accessFile" > "$tmp" && mv "$tmp" "$accessFile"

echo "Access granted: user '$user_id' → org '$org_name'"
```

### revoke-access

```bash
[ -z "$user_id" ] && { echo "ERROR: --user-id required."; exit 1; }
[ -z "$org_name" ] && { echo "ERROR: --org-name required."; exit 1; }

accessFile=".monomind/instance-access.json"
[ ! -f "$accessFile" ] && { echo "No access file found."; exit 1; }

tmp="${accessFile}.tmp"
jq --arg uid "$user_id" --arg org "$org_name" \
  '.users = [.users[] | if .id == $uid then
     .companyAccess = [(.companyAccess // [])[] | select(. != $org)]
   else . end]' \
  "$accessFile" > "$tmp" && mv "$tmp" "$accessFile"

echo "Access revoked: user '$user_id' from org '$org_name'"
```

### set-admin

```bash
[ -z "$user_id" ] && { echo "ERROR: --user-id required."; exit 1; }

accessFile=".monomind/instance-access.json"
[ ! -f "$accessFile" ] && echo '{"users":[]}' > "$accessFile"

tmp="${accessFile}.tmp"
jq --arg uid "$user_id" \
  '.users = (if any(.users[]; .id == $uid) then
    [.users[] | if .id == $uid then .isInstanceAdmin = true else . end]
  else .users + [{"id":$uid,"companyAccess":[],"isInstanceAdmin":true}] end)' \
  "$accessFile" > "$tmp" && mv "$tmp" "$accessFile"

echo "User '$user_id' granted instance admin role."
```

### unset-admin

```bash
[ -z "$user_id" ] && { echo "ERROR: --user-id required."; exit 1; }

accessFile=".monomind/instance-access.json"
tmp="${accessFile}.tmp"
jq --arg uid "$user_id" \
  '.users = [.users[] | if .id == $uid then .isInstanceAdmin = false else . end]' \
  "$accessFile" > "$tmp" && mv "$tmp" "$accessFile"

echo "Instance admin revoked for user '$user_id'."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
